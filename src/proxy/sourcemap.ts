// Maps a bundled stack position (as seen by the browser through the proxy) back to an original
// source file:line via the bundle's source map. Any failure resolves to null.
import { SourceMapConsumer } from 'source-map-js'
import type { SourceLoc } from '../../plugin/hooks/lib/types.js'

export type SourceResolverOptions = {
  target: number // dev-server port; bundles are fetched from http://localhost:<target>
  cwd: string // project root; absolute source paths under it become relative
  timeoutMs?: number
  cacheSize?: number
  cacheTtlMs?: number
}

type Entry = { consumer: SourceMapConsumer; mapBase: string; at: number }

const SCHEME_PREFIXES = [/^webpack:\/\/_N_E\//, /^webpack:\/\/\//, /^webpack:\/\/[^/]*\//, /^turbopack:\/\/\/\[project\]\//, /^file:\/\//]

/** Normalizes a source-map `sources` entry into a project-relative path when possible. */
export function normalizeSourcePath(file: string, cwd: string): string {
  let f = file.replace(/^\0+/, '')
  f = f.replace(/[?#].*$/, '')
  for (const re of SCHEME_PREFIXES) f = f.replace(re, '')
  if (f.startsWith('/@fs/')) f = f.slice('/@fs'.length)
  while (f.startsWith('./')) f = f.slice(2)
  const root = cwd.replace(/\/+$/, '')
  if (root && f.startsWith(root + '/')) f = f.slice(root.length + 1)
  return f
}

const NEXT_SCHEMES = new Set(['webpack-internal:', 'about:', 'rsc:', 'file:'])

const hasScheme = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s)

function lastSourceMappingUrl(js: string): string | null {
  const re = /\/[/*][#@]\s*sourceMappingURL=([^\s'"*]+)/g
  let last: string | null = null
  for (let m = re.exec(js); m; m = re.exec(js)) last = m[1]
  return last
}

function decodeDataUrl(ref: string): string {
  const comma = ref.indexOf(',')
  if (comma < 0) throw new Error('bad data url')
  const meta = ref.slice(5, comma)
  const payload = ref.slice(comma + 1)
  return /;base64$/i.test(meta) ? Buffer.from(payload, 'base64').toString('utf8') : decodeURIComponent(payload)
}

export function createSourceResolver(opts: SourceResolverOptions) {
  const timeoutMs = opts.timeoutMs ?? 3000
  const cacheSize = opts.cacheSize ?? 50
  // Short TTL: chunk URLs without a cache-busting query (Next.js) change content on rebuild.
  const cacheTtlMs = opts.cacheTtlMs ?? 10_000
  const origin = `http://localhost:${opts.target}`
  const cache = new Map<string, Entry>() // insertion order = LRU order

  // Any URL the browser saw (proxy host) is re-pointed at the dev server. String concatenation,
  // not `new URL(path, origin)`: a `//host/...` pathname would be protocol-relative (SSRF).
  const toUpstream = (u: URL) => {
    const out = new URL(origin + u.pathname + u.search)
    if (out.origin !== origin) throw new Error('refusing non-upstream origin')
    return out
  }

  async function fetchText(url: URL): Promise<string> {
    if (url.origin !== origin) throw new Error('refusing non-upstream origin')
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }

  // `jsUrl`: a bundle to read the sourceMappingURL from; `direct`: the URL of the map itself.
  async function load(jsUrl: URL, direct = false): Promise<Entry> {
    const key = jsUrl.href
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < cacheTtlMs) {
      cache.delete(key)
      cache.set(key, hit)
      return hit
    }
    let raw: string
    let mapUrl: URL
    if (direct) {
      raw = await fetchText(jsUrl)
      mapUrl = jsUrl
    } else {
      const js = await fetchText(jsUrl)
      const ref = lastSourceMappingUrl(js)
      if (!ref) throw new Error('no sourceMappingURL')
      if (ref.startsWith('data:')) {
        raw = decodeDataUrl(ref)
        mapUrl = jsUrl
      } else {
        mapUrl = toUpstream(new URL(ref, jsUrl))
        raw = await fetchText(mapUrl)
      }
    }
    const entry: Entry = { consumer: new SourceMapConsumer(JSON.parse(raw)), mapBase: mapUrl.pathname, at: Date.now() }
    cache.delete(key)
    cache.set(key, entry)
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string)
    return entry
  }

  function toFile(source: string, mapBase: string): string {
    const clean = source.replace(/^\0+/, '')
    // Relative sources (no scheme, not absolute — e.g. Vite's `PlanCard.tsx`) are relative to
    // the map's URL; resolve them against it and drop the leading `/` of the served path.
    if (!hasScheme(clean) && !clean.startsWith('/')) {
      const path = decodeURIComponent(new URL(clean.replace(/[?#].*$/, ''), `http://x${mapBase}`).pathname)
      return normalizeSourcePath(path.startsWith('/@fs/') ? path : path.slice(1), opts.cwd)
    }
    return normalizeSourcePath(clean, opts.cwd)
  }

  return async function resolveSource(url: string, line: number, column: number): Promise<SourceLoc | null> {
    try {
      const u = new URL(url)
      let entry: Entry
      if (u.protocol === 'http:' || u.protocol === 'https:') entry = await load(toUpstream(u))
      else if (NEXT_SCHEMES.has(u.protocol)) {
        // Next.js dev: webpack-internal modules and replayed Server Component frames
        // (`about://React/Server/…`) are not fetchable as JS; Next serves their maps by name.
        entry = await load(new URL(`${origin}/__nextjs_source-map?${new URLSearchParams({ filename: url })}`), true)
      } else return null
      const { consumer, mapBase } = entry
      // Stack columns are 1-based; source-map-js wants a 0-based column.
      const pos = consumer.originalPositionFor({ line, column: Math.max(0, column - 1) })
      if (!pos.source || pos.line == null) return null
      const loc: SourceLoc = { file: toFile(pos.source, mapBase), line: pos.line }
      if (pos.column != null) loc.column = pos.column + 1 // report 1-based, like the line
      return loc
    } catch {
      return null
    }
  }
}
