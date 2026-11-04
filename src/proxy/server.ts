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

/**
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
    if (req.headers.origin) proxyReq.setHeader('origin', upstreamOrigin)
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
      res.end(`<!doctype html><meta charset="utf-8"><p>web-inspect: dev server na portu ${target} neodpovídá</p>`)
    } else {
      ;(res as Duplex).destroy()
    }
  })

  const server = http.createServer((req, res) => {
    if (handleOwn(req, res)) return
    proxy.web(req, res)
  })

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy())
    proxy.ws(req, socket, head)
  })

  server.on('close', () => proxy.close())

  return server
}
