import http from 'node:http'
import zlib from 'node:zlib'
import type { Duplex, Readable } from 'node:stream'
import httpProxy from 'http-proxy'
import { createInjector } from './inject.js'

export type ProxyOptions = {
  target: number
  overlayTag: string
  handleOwn: (req: http.IncomingMessage, res: http.ServerResponse) => boolean
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** True when a Host header names this machine (localhost, 127.0.0.1 or [::1], any port). */
export function isLocalHost(host: string | undefined): boolean {
  if (!host || /[\s/@?#\\]/.test(host)) return false
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname)
  } catch {
    return false
  }
}

/** True when an Origin header is absent or names a local http(s) origin. */
export function isLocalOrigin(origin: string | string[] | undefined): boolean {
  if (origin === undefined) return true
  if (typeof origin !== 'string') return false
  try {
    const u = new URL(origin)
    return (u.protocol === 'http:' || u.protocol === 'https:') && LOCAL_HOSTNAMES.has(u.hostname)
  } catch {
    return false
  }
}

const FORBIDDEN = 'web-inspect: only localhost Host is accepted'

/**
 * DNS-rebinding guard: a malicious site that rebinds its name to 127.0.0.1 would
 * reach us with `Host: evil.example:<port>`. Only local Host headers are served,
 * for proxied requests, own /__web-inspect paths and WebSocket upgrades alike.
 *
 * Upstream host decision: we connect to `localhost` (not a literal 127.0.0.1)
 * so Node's happy-eyeballs (autoSelectFamily) tries both ::1 and 127.0.0.1;
 * dev servers (Vite, Next) bind just one of the families. The Host and Origin
 * headers are rewritten to `localhost:<target>` so the dev server's host/CSRF
 * checks accept the request.
 */
export function createProxyServer(opts: ProxyOptions): http.Server {
  const { target, overlayTag, handleOwn } = opts
  const upstreamHost = `localhost:${target}`
  const upstreamOrigin = `http://${upstreamHost}`

  const proxy = httpProxy.createProxyServer({
    target: `http://${upstreamHost}`,
    ws: true,
    changeOrigin: true,
    xfwd: false,
    selfHandleResponse: true,
  })

  const rewrite = (proxyReq: http.ClientRequest, req: http.IncomingMessage) => {
    proxyReq.setHeader('host', upstreamHost)
    // Only our own (local) origin is translated; a foreign one goes through unchanged so the dev
    // server's own CSRF/WebSocket origin checks still see it.
    if (req.headers.origin && isLocalOrigin(req.headers.origin)) proxyReq.setHeader('origin', upstreamOrigin)
  }

  proxy.on('proxyReq', (proxyReq, req) => {
    rewrite(proxyReq, req)
    // Navigation requests: ask for an uncompressed body so we can inject cheaply.
    if (String(req.headers.accept ?? '').includes('text/html')) {
      proxyReq.removeHeader('accept-encoding')
    }
  })
  proxy.on('proxyReqWs', (proxyReq, req) => rewrite(proxyReq, req))

  proxy.on('proxyRes', (proxyRes, _req, res) => {
    const headers = { ...proxyRes.headers }
    const type = String(headers['content-type'] ?? '')
    if (!/^text\/html/i.test(type)) {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, proxyRes.rawHeaders as unknown as string[])
      proxyRes.pipe(res)
      return
    }
    const encoding = String(headers['content-encoding'] ?? '').trim().toLowerCase()
    let source: Readable = proxyRes
    if (encoding === 'gzip' || encoding === 'x-gzip') source = proxyRes.pipe(zlib.createGunzip())
    else if (encoding === 'br') source = proxyRes.pipe(zlib.createBrotliDecompress())
    else if (encoding === 'deflate') source = proxyRes.pipe(zlib.createInflate())
    else if (encoding && encoding !== 'identity') {
      // Unknown encoding: cannot inject, pass through untouched.
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, proxyRes.rawHeaders as unknown as string[])
      proxyRes.pipe(res)
      return
    }
    delete headers['content-encoding']
    delete headers['content-length']
    res.writeHead(proxyRes.statusCode ?? 502, proxyRes.statusMessage, headers)
    const injector = createInjector(overlayTag)
    source.on('error', () => res.destroy())
    source.pipe(injector).pipe(res)
  })

  proxy.on('error', (_err, _req, res) => {
    if (res instanceof http.ServerResponse) {
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' })
      }
      res.end(`<!doctype html><meta charset="utf-8"><p>web-inspect: the dev server on port ${target} isn’t responding</p>`)
    } else {
      ;(res as Duplex).destroy()
    }
  })

  const server = http.createServer((req, res) => {
    if (!isLocalHost(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' })
      res.end(FORBIDDEN)
      return
    }
    if (handleOwn(req, res)) return
    proxy.web(req, res)
  })

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy())
    if (!isLocalHost(req.headers.host)) {
      socket.end(
        `HTTP/1.1 403 Forbidden\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(FORBIDDEN)}\r\nconnection: close\r\n\r\n${FORBIDDEN}`,
      )
      return
    }
    proxy.ws(req, socket, head)
  })

  server.on('close', () => proxy.close())

  return server
}
