import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApi, createWatchdog } from '../../src/proxy/api.js'
import { InstructionStore } from '../../src/proxy/store.js'
import { createProxyServer } from '../../src/proxy/server.js'
import type { InstructionItem } from '../../plugin/hooks/lib/types.js'

const TOKEN = 'tok'
const item: InstructionItem = {
  instruction: 'make it red',
  element: { text: '', tag: 'div', attrs: {}, domPath: 'div', selector: 'div', components: [], outerHTML: '<div></div>' },
}
const P = '/__web-inspect'

let servers: http.Server[] = []
afterEach(async () => {
  for (const s of servers) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
  servers = []
})

async function start(over: Partial<Parameters<typeof createApi>[1]> = {}) {
  const store = new InstructionStore()
  const onShutdown = vi.fn()
  const onHeartbeat = vi.fn()
  const handleOwn = createApi(store, {
    token: TOKEN,
    overlayJsPath: '/nonexistent/overlay.js',
    resolveSource: async () => null,
    onShutdown,
    onHeartbeat,
    ...over,
  })
  const server = createProxyServer({ target: 1, overlayTag: '', handleOwn })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push(server)
  const port = (server.address() as AddressInfo).port
  const call = async (method: string, path: string, body?: unknown, token: string | null = TOKEN) => {
    const res = await fetch(`http://127.0.0.1:${port}${P}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { 'x-web-inspect-token': token } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, json: text ? safe(text) : null, headers: res.headers, text }
  }
  return { store, port, call, onShutdown, onHeartbeat }
}
const safe = (t: string) => { try { return JSON.parse(t) } catch { return null } }

describe('api auth', () => {
  it('401 without or with wrong token', async () => {
    const { call } = await start()
    expect((await call('POST', '/api/poll', { canTake: true }, null)).status).toBe(401)
    expect((await call('POST', '/api/poll', { canTake: true }, 'bad')).status).toBe(401)
    expect((await call('POST', '/api/poll', { canTake: true })).status).toBe(200)
  })
  it('unknown path under prefix is 404; outside prefix not handled', async () => {
    const { call } = await start()
    expect((await call('GET', '/nope')).status).toBe(404)
  })
  it('invalid JSON 400, oversized 413', async () => {
    const { call } = await start()
    expect((await call('POST', '/api/poll', '{bad')).status).toBe(400)
    expect((await call('POST', '/api/instructions', 'x'.repeat(1024 * 1024 + 10))).status).toBe(413)
  })
})

describe('overlay.js', () => {
  it('served without token, fallback when missing', async () => {
    const { call } = await start()
    const r = await call('GET', '/overlay.js', undefined, null)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('application/javascript; charset=utf-8')
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.text).toContain('web-inspect: overlay bundle missing')
  })
  it('serves file content', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const f = join(mkdtempSync(join(tmpdir(), 'wi-')), 'overlay.js')
    writeFileSync(f, 'console.log(1)')
    const { call } = await start({ overlayJsPath: f })
    expect((await call('GET', '/overlay.js', undefined, null)).text).toBe('console.log(1)')
  })
})

describe('instructions flow', () => {
  it('POST instructions then SSE snapshot has queued item', async () => {
    const { call, port } = await start()
    const { json } = await call('POST', '/api/instructions', { pageUrl: 'http://a/', items: [item] })
    expect(typeof json.id).toBe('string')
    const body = await new Promise<string>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${port}${P}/api/events?token=${TOKEN}`, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream')
        res.setEncoding('utf8')
        res.once('data', (d) => { resolve(d); req.destroy() })
      })
      req.on('error', reject)
    })
    expect(body).toMatch(/^event: snapshot\ndata: /)
    const snap = JSON.parse(body.split('data: ')[1])
    expect(snap.queue).toEqual([{ id: json.id, status: 'queued', summary: 'make it red' }])
  })
  it('SSE rejects bad token', async () => {
    const { port } = await start()
    const res = await fetch(`http://127.0.0.1:${port}${P}/api/events?token=bad`)
    expect(res.status).toBe(401)
  })
  it('SSE pushes on change', async () => {
    const { call, port } = await start()
    const chunks: string[] = []
    const req = http.get(`http://127.0.0.1:${port}${P}/api/events?token=${TOKEN}`, (res) => {
      res.setEncoding('utf8')
      res.on('data', (d) => chunks.push(d))
    })
    await vi.waitFor(() => expect(chunks.join('')).toContain('event: snapshot'))
    await call('POST', '/api/instructions', { pageUrl: 'u', items: [item] })
    await vi.waitFor(() => expect(chunks.join('')).toContain('"queued"'))
    req.destroy()
  })
  it('two concurrent polls take exactly one instruction', async () => {
    const { call } = await start()
    await call('POST', '/api/instructions', { pageUrl: 'u', items: [item] })
    const rs = await Promise.all([call('POST', '/api/poll', { canTake: true }), call('POST', '/api/poll', { canTake: true })])
    expect(rs.filter((r) => r.json.instruction !== null)).toHaveLength(1)
  })
  it('poll canTake:false takes nothing; both heartbeat', async () => {
    const { call, store, onHeartbeat } = await start()
    await call('POST', '/api/instructions', { pageUrl: 'u', items: [item] })
    expect((await call('POST', '/api/poll', { canTake: false })).json).toEqual({ instruction: null })
    expect(store.snapshot().queue[0].status).toBe('queued')
    await call('POST', '/api/progress', { kind: 'info', label: 'x', at: 1 })
    expect(onHeartbeat).toHaveBeenCalledTimes(2)
    expect(store.snapshot().progress).toHaveLength(1)
  })
  it('status: ok, 404 unknown', async () => {
    const { call } = await start()
    const { json } = await call('POST', '/api/instructions', { pageUrl: 'u', items: [item] })
    expect((await call('POST', '/api/status', { id: json.id, status: 'running' })).json).toEqual({ ok: true })
    expect((await call('POST', '/api/status', { id: 'nope', status: 'done' })).status).toBe(404)
  })
  it('resend: ok for aborted, 404 unknown', async () => {
    const { call } = await start()
    const { json } = await call('POST', '/api/instructions', { pageUrl: 'u', items: [item] })
    await call('POST', '/api/poll', { canTake: true })
    await call('POST', '/api/status', { id: json.id, status: 'aborted' })
    expect((await call('POST', '/api/resend', { id: json.id })).json).toEqual({ ok: true })
    expect((await call('POST', '/api/resend', { id: 'nope' })).status).toBe(404)
  })
  it('validates instruction body', async () => {
    const { call } = await start()
    expect((await call('POST', '/api/instructions', { pageUrl: 'u' })).status).toBe(400)
  })
  it('resolve-source uses injected resolver', async () => {
    const { call } = await start({ resolveSource: async (u, l, c) => ({ file: u, line: l, column: c }) })
    expect((await call('POST', '/api/resolve-source', { url: 'f', line: 2, column: 3 })).json).toEqual({ file: 'f', line: 2, column: 3 })
  })
  it('shutdown calls onShutdown', async () => {
    const { call, onShutdown } = await start()
    expect((await call('POST', '/api/shutdown', {})).json).toEqual({ ok: true })
    await vi.waitFor(() => expect(onShutdown).toHaveBeenCalled())
  })
})

describe('watchdog', () => {
  it('fires without heartbeat', async () => {
    const onTimeout = vi.fn()
    const w = createWatchdog({ heartbeatTimeoutMs: 200, graceMs: 200, checkIntervalMs: 20, onTimeout })
    await vi.waitFor(() => expect(onTimeout).toHaveBeenCalledTimes(1))
    w.stop()
  })
  it('does not fire with heartbeats every 50ms', async () => {
    const onTimeout = vi.fn()
    const w = createWatchdog({ heartbeatTimeoutMs: 200, graceMs: 200, checkIntervalMs: 20, onTimeout })
    const t = setInterval(() => w.heartbeat(), 50)
    await new Promise((r) => setTimeout(r, 500))
    clearInterval(t)
    expect(onTimeout).not.toHaveBeenCalled()
    w.stop()
  })
  it('defaults: 15s after heartbeat, 30s grace', () => {
    vi.useFakeTimers()
    try {
      const onTimeout = vi.fn()
      const w = createWatchdog({ onTimeout })
      vi.advanceTimersByTime(29_000)
      expect(onTimeout).not.toHaveBeenCalled()
      w.heartbeat()
      vi.advanceTimersByTime(14_000)
      expect(onTimeout).not.toHaveBeenCalled()
      vi.advanceTimersByTime(3_000)
      expect(onTimeout).toHaveBeenCalledTimes(1)
      w.stop()
    } finally {
      vi.useRealTimers()
    }
  })
  it('grace: no shutdown before 30s without heartbeat', () => {
    vi.useFakeTimers()
    try {
      const onTimeout = vi.fn()
      const w = createWatchdog({ onTimeout })
      vi.advanceTimersByTime(29_500)
      expect(onTimeout).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1_500)
      expect(onTimeout).toHaveBeenCalledTimes(1)
      w.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
