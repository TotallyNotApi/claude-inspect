import type http from 'node:http'
import { readFile } from 'node:fs/promises'
import { timingSafeEqual } from 'node:crypto'
import type { InstructionStatus, ProgressEvent, SourceLoc } from '../../plugin/hooks/lib/types.js'
import type { InstructionStore } from './store.js'

const PREFIX = '/__web-inspect'
const MAX_BODY = 1024 * 1024
const KEEPALIVE_MS = 15_000
const STATUSES: InstructionStatus[] = ['queued', 'sent', 'running', 'done', 'aborted', 'held']
const KINDS = ['tool', 'waiting-permission', 'turn-done', 'turn-aborted', 'info']

export type ApiOptions = {
  token: string
  overlayJsPath: string
  resolveSource?: (url: string, line: number, column: number) => Promise<SourceLoc | null>
  onShutdown: () => void
  onHeartbeat: () => void
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const MISSING_OVERLAY = "console.warn('web-inspect: overlay bundle missing — run npm run build')\n"

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function tokenOk(given: string | undefined, token: string): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let failed = false
    req.on('data', (c: Buffer) => {
      if (failed) return
      size += c.length
      if (size > MAX_BODY) {
        failed = true
        chunks.length = 0
        reject(new HttpError(413, 'body too large'))
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (failed) return
      const text = Buffer.concat(chunks).toString('utf8')
      if (!text.trim()) return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new HttpError(400, 'invalid JSON'))
      }
    })
    req.on('error', (e) => reject(e))
  })
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function createApi(
  store: InstructionStore,
  opts: ApiOptions,
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  const resolveSource = opts.resolveSource ?? (async () => null)

  async function serveOverlay(res: http.ServerResponse): Promise<void> {
    let body: string | Buffer
    try {
      body = await readFile(opts.overlayJsPath)
    } catch {
      body = MISSING_OVERLAY
    }
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-store' })
    res.end(body)
  }

  function serveEvents(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const send = () => res.write(`event: snapshot\ndata: ${JSON.stringify(store.snapshot())}\n\n`)
    send()
    const off = store.onChange(send)
    const timer = setInterval(() => res.write(':\n\n'), KEEPALIVE_MS)
    timer.unref()
    const cleanup = () => {
      clearInterval(timer)
      off()
    }
    req.on('close', cleanup)
    res.on('close', cleanup)
  }

  async function route(req: http.IncomingMessage, res: http.ServerResponse, url: URL, path: string): Promise<void> {
    const method = req.method ?? 'GET'

    if (path === '/overlay.js' && method === 'GET') return serveOverlay(res)

    if (!path.startsWith('/api/')) throw new HttpError(404, 'not found')

    const given = (req.headers['x-web-inspect-token'] as string | undefined) ?? url.searchParams.get('token') ?? undefined
    // Header is the rule; ?token= is accepted for SSE (EventSource cannot set headers).
    if (!tokenOk(given, opts.token)) throw new HttpError(401, 'unauthorized')

    if (path === '/api/events' && method === 'GET') return serveEvents(req, res)
    if (method !== 'POST') throw new HttpError(404, 'not found')

    const body = await readJson(req)
    switch (path) {
      case '/api/instructions': {
        if (!isObj(body) || typeof body.pageUrl !== 'string' || !Array.isArray(body.items) || body.items.length === 0)
          throw new HttpError(400, 'pageUrl and non-empty items required')
        const ins = store.add(body.pageUrl, body.items)
        return sendJson(res, 200, { id: ins.id })
      }
      case '/api/resend': {
        if (!isObj(body) || typeof body.id !== 'string') throw new HttpError(400, 'id required')
        if (!store.has(body.id)) throw new HttpError(404, 'unknown id')
        if (!store.resend(body.id)) throw new HttpError(409, 'instruction not resendable')
        return sendJson(res, 200, { ok: true })
      }
      case '/api/poll': {
        opts.onHeartbeat()
        const canTake = isObj(body) && body.canTake === true
        return sendJson(res, 200, { instruction: canTake ? store.take() : null })
      }
      case '/api/status': {
        opts.onHeartbeat()
        if (!isObj(body) || typeof body.id !== 'string' || !STATUSES.includes(body.status))
          throw new HttpError(400, 'id and valid status required')
        if (!store.setStatus(body.id, body.status)) throw new HttpError(404, 'unknown id')
        return sendJson(res, 200, { ok: true })
      }
      case '/api/progress': {
        opts.onHeartbeat()
        if (!isObj(body) || !KINDS.includes(body.kind) || typeof body.label !== 'string')
          throw new HttpError(400, 'invalid progress event')
        const ev: ProgressEvent = {
          kind: body.kind,
          label: body.label,
          at: typeof body.at === 'number' ? body.at : Date.now(),
          ...(typeof body.instructionId === 'string' ? { instructionId: body.instructionId } : {}),
        }
        store.pushProgress(ev)
        return sendJson(res, 200, { ok: true })
      }
      case '/api/resolve-source': {
        if (!isObj(body) || typeof body.url !== 'string' || typeof body.line !== 'number')
          throw new HttpError(400, 'url and line required')
        const loc = await resolveSource(body.url, body.line, typeof body.column === 'number' ? body.column : 0)
        return sendJson(res, 200, loc)
      }
      case '/api/shutdown': {
        sendJson(res, 200, { ok: true })
        res.on('close', () => opts.onShutdown())
        return
      }
      default:
        throw new HttpError(404, 'not found')
    }
  }

  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== PREFIX && !url.pathname.startsWith(PREFIX + '/')) return false
    const path = url.pathname.slice(PREFIX.length)
    route(req, res, url, path).catch((e) => {
      if (res.headersSent) return res.destroy()
      if (e instanceof HttpError) {
        if (e.status === 413) res.setHeader('connection', 'close')
        return sendJson(res, e.status, { error: e.message })
      }
      sendJson(res, 500, { error: 'internal error' })
    })
    return true
  }
}

export type WatchdogOptions = {
  heartbeatTimeoutMs?: number
  graceMs?: number
  checkIntervalMs?: number
  onTimeout: () => void
}

/** Fires onTimeout once when no heartbeat arrives within heartbeatTimeoutMs (grace period after start). */
export function createWatchdog(opts: WatchdogOptions): { heartbeat(): void; stop(): void } {
  const timeout = opts.heartbeatTimeoutMs ?? 15_000
  const grace = opts.graceMs ?? 30_000
  const start = Date.now()
  let last: number | null = null
  let fired = false
  const timer = setInterval(() => {
    const deadline = last === null ? start + grace : Math.max(start + grace, last + timeout)
    if (!fired && Date.now() >= deadline) {
      fired = true
      clearInterval(timer)
      opts.onTimeout()
    }
  }, opts.checkIntervalMs ?? 1000)
  return {
    heartbeat() {
      last = Date.now()
    },
    stop() {
      clearInterval(timer)
    },
  }
}
