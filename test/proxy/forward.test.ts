import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, WebSocket } from 'ws'
import { createProxyServer } from '../../src/proxy/server.js'

const TAG = '<script src="/__web-inspect/overlay.js"></script>'
const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (closers.length) await closers.pop()!()
})

function listen(server: http.Server): Promise<number> {
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => res((server.address() as AddressInfo).port))
    closers.push(
      () =>
        new Promise<void>((r) => {
          server.close(() => r())
          server.closeAllConnections()
        }),
    )
  })
}

type Seen = { host?: string; origin?: string; acceptEncoding?: string; protocol?: string; hits: number }

async function startUpstream(handler?: http.RequestListener) {
  const seen: Seen = { hits: 0 }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255, 254])
  const server = http.createServer((req, res) => {
    seen.hits++
    seen.host = req.headers.host
    seen.origin = req.headers.origin as string | undefined
    seen.acceptEncoding = req.headers['accept-encoding'] as string | undefined
    if (handler) return handler(req, res)
    if (req.url === '/gz') {
      const body = zlib.gzipSync('<html><head><title>t</title></head><body>ahoj</body></html>')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip', 'content-length': body.length })
      return res.end(body)
    }
    if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json', 'x-custom': 'yes' })
      return res.end('{"a":1}')
    }
    if (req.url === '/img') {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': png.length })
      return res.end(png)
    }
    res.writeHead(404).end()
  })
  const wss = new WebSocketServer({ server })
  wss.on('connection', (ws, req) => {
    seen.protocol = req.headers['sec-websocket-protocol'] as string | undefined
    ws.on('message', (m) => ws.send('echo:' + m.toString()))
  })
  const port = await listen(server)
  closers.push(async () => {
    wss.clients.forEach((c) => c.terminate())
    wss.close()
  })
  return { port, seen, png }
}

async function startProxy(target: number, handleOwn: (req: http.IncomingMessage, res: http.ServerResponse) => boolean = () => false) {
  const proxy = createProxyServer({ target, overlayTag: TAG, handleOwn })
  const port = await listen(proxy)
  return port
}

function get(port: number, path: string, headers: http.OutgoingHttpHeaders = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path, headers, agent: false }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
  })
}

describe('proxy forwarding', () => {
  it('decompresses gzip HTML and injects the tag', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    const r = await get(port, '/gz', { accept: 'text/html' })
    const body = r.body.toString('utf8')
    expect(body).toBe(`<html><head>${TAG}<title>t</title></head><body>ahoj</body></html>`)
    expect(r.headers['content-encoding']).toBeUndefined()
    expect(r.headers['content-length']).toBeUndefined()
    expect(r.headers['content-type']).toBe('text/html; charset=utf-8')
  })

  it('strips accept-encoding on navigation requests only', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    await get(port, '/json', { accept: 'text/html,application/xhtml+xml', 'accept-encoding': 'gzip, br' })
    expect(up.seen.acceptEncoding).toBeUndefined()
    await get(port, '/json', { accept: '*/*', 'accept-encoding': 'gzip' })
    expect(up.seen.acceptEncoding).toBe('gzip')
  })

  it('passes JSON and images through byte-for-byte with headers', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    const j = await get(port, '/json')
    expect(j.body.toString()).toBe('{"a":1}')
    expect(j.headers['x-custom']).toBe('yes')
    expect(j.headers['content-type']).toBe('application/json')
    const i = await get(port, '/img')
    expect(i.body.equals(up.png)).toBe(true)
    expect(i.headers['content-length']).toBe(String(up.png.length))
  })

  it('rewrites host and origin for the upstream', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    await get(port, '/json', { origin: `http://localhost:${port}` })
    expect(up.seen.host).toBe(`localhost:${up.port}`)
    expect(up.seen.origin).toBe(`http://localhost:${up.port}`)
  })

  it('proxies WebSocket upgrades with subprotocol, both directions', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, 'vite-hmr')
    const msg = await new Promise<string>((res, rej) => {
      ws.on('open', () => ws.send('hi'))
      ws.on('message', (m) => res(m.toString()))
      ws.on('error', rej)
    })
    expect(msg).toBe('echo:hi')
    expect(up.seen.protocol).toBe('vite-hmr')
    expect(ws.protocol).toBe('vite-hmr')
    await new Promise<void>((r) => {
      ws.on('close', () => r())
      ws.close()
    })
  })

  it('returns 502 with a simple HTML message when upstream is down', async () => {
    const dead = http.createServer()
    const deadPort = await listen(dead)
    await new Promise<void>((r) => dead.close(() => r()))
    const port = await startProxy(deadPort)
    const r = await get(port, '/')
    expect(r.status).toBe(502)
    expect(r.headers['content-type']).toContain('text/html')
    expect(r.body.toString()).toContain(`web-inspect: dev server na portu ${deadPort} neodpovídá`)
  })

  it('does not forward requests handled by handleOwn', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port, (req, res) => {
      if (req.url?.startsWith('/__web-inspect/')) {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('own')
        return true
      }
      return false
    })
    const r = await get(port, '/__web-inspect/x')
    expect(r.body.toString()).toBe('own')
    expect(up.seen.hits).toBe(0)
  })
})

describe('DNS rebinding guard', () => {
  it('rejects a foreign Host with 403 plain text and does not forward', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    const r = await get(port, '/json', { host: `evil.example:${port}` })
    expect(r.status).toBe(403)
    expect(r.headers['content-type']).toContain('text/plain')
    expect(up.seen.hits).toBe(0)
  })

  it('rejects a foreign Host also for own /__web-inspect paths', async () => {
    const up = await startUpstream()
    let own = 0
    const port = await startProxy(up.port, () => {
      own++
      return false
    })
    const r = await get(port, '/__web-inspect/overlay.js', { host: 'evil.example' })
    expect(r.status).toBe(403)
    expect(own).toBe(0)
  })

  it('accepts localhost, 127.0.0.1 and [::1] on any port', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, 'localhost', 'LOCALHOST:1']) {
      const r = await get(port, '/json', { host })
      expect(r.status, host).toBe(200)
    }
  })

  it('rejects a missing or lookalike Host', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    for (const host of ['localhost.evil.example', '127.0.0.1.nip.io', 'evil.example@localhost']) {
      const r = await get(port, '/json', { host })
      expect(r.status, host).toBe(403)
    }
  })

  it('rejects a WebSocket upgrade with a foreign Host', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { headers: { host: `evil.example:${port}` } })
    const status = await new Promise<number>((res, rej) => {
      ws.on('unexpected-response', (_req, resp) => res(resp.statusCode!))
      ws.on('open', () => res(101))
      ws.on('error', rej)
    })
    expect(status).toBe(403)
    expect(up.seen.hits).toBe(0)
  })

  it('passes a foreign Origin to the upstream unchanged (only local origins are rewritten)', async () => {
    const up = await startUpstream()
    const port = await startProxy(up.port)
    await get(port, '/json', { origin: 'https://accounts.example' })
    expect(up.seen.origin).toBe('https://accounts.example')
  })
})
