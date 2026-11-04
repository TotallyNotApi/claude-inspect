import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { SourceMapGenerator } from 'source-map-js'
import { afterEach, describe, expect, it } from 'vitest'
import { createSourceResolver, normalizeSourcePath } from '../../src/proxy/sourcemap.js'

const CWD = '/home/me/app'

let servers: http.Server[] = []
afterEach(async () => {
  for (const s of servers) {
    s.closeAllConnections()
    await new Promise((r) => s.close(r))
  }
  servers = []
})

// Generated line 20 col 4 (0-based) ↔ original line 8 col 9 (0-based) of `source`.
function makeMap(source: string, sourceRoot?: string): string {
  const g = new SourceMapGenerator({ file: 'bundle.js', sourceRoot })
  g.addMapping({ generated: { line: 20, column: 4 }, original: { line: 8, column: 9 }, source })
  return g.toString()
}

async function upstream(routes: Record<string, string>) {
  const hits: string[] = []
  const s = http.createServer((req, res) => {
    hits.push(req.url!)
    const body = routes[req.url!]
    if (body === undefined) {
      res.writeHead(404).end('nope')
      return
    }
    res.writeHead(200, { 'content-type': 'application/javascript' }).end(body)
  })
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return { port: (s.address() as AddressInfo).port, hits }
}

const js = (tail: string) => `${'\n'.repeat(19)}    doThing()\n${tail}\n`

describe('resolveSource', () => {
  it('maps through an inline data: source map (proxy host replaced with target)', async () => {
    const map = Buffer.from(makeMap('/home/me/app/src/components/PlanCard.tsx')).toString('base64')
    const { port, hits } = await upstream({
      '/src/components/PlanCard.tsx?t=1': js(`//# sourceMappingURL=data:application/json;base64,${map}`),
    })
    const resolve = createSourceResolver({ target: port, cwd: CWD })
    const loc = await resolve('http://localhost:4000/src/components/PlanCard.tsx?t=1', 20, 5)
    expect(loc).toEqual({ file: 'src/components/PlanCard.tsx', line: 8, column: 10 })
    expect(hits).toEqual(['/src/components/PlanCard.tsx?t=1'])
  })

  it('handles charset=utf-8 inline maps and uses the LAST sourceMappingURL', async () => {
    const good = Buffer.from(makeMap('webpack://_N_E/./src/components/PlanCard.tsx?abc')).toString('base64')
    const { port } = await upstream({
      '/a.js': js(
        `//# sourceMappingURL=bogus.map\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${good}`,
      ),
    })
    const loc = await createSourceResolver({ target: port, cwd: CWD })(`http://localhost:4000/a.js`, 20, 5)
    expect(loc).toMatchObject({ file: 'src/components/PlanCard.tsx', line: 8 })
  })

  it('fetches an external .map relative to the JS URL and honours sourceRoot; caches parsed maps', async () => {
    const { port, hits } = await upstream({
      '/_next/static/chunks/app/page.js': js('//# sourceMappingURL=page.js.map'),
      '/_next/static/chunks/app/page.js.map': makeMap('components/PlanCard.tsx', 'webpack:///./src/'),
    })
    const resolve = createSourceResolver({ target: port, cwd: CWD })
    const url = 'http://localhost:4000/_next/static/chunks/app/page.js'
    expect(await resolve(url, 20, 5)).toMatchObject({ file: 'src/components/PlanCard.tsx', line: 8 })
    expect(await resolve(url, 20, 5)).toMatchObject({ file: 'src/components/PlanCard.tsx', line: 8 })
    expect(hits).toEqual(['/_next/static/chunks/app/page.js', '/_next/static/chunks/app/page.js.map'])
  })

  it('resolves Vite-style relative sources against the module URL', async () => {
    const map = Buffer.from(makeMap('PlanCard.tsx')).toString('base64')
    const { port } = await upstream({
      '/src/components/PlanCard.tsx?t=2': js(`//# sourceMappingURL=data:application/json;base64,${map}`),
      '/@fs/home/me/app/lib/Card.tsx': js(`//# sourceMappingURL=data:application/json;base64,${Buffer.from(makeMap('Card.tsx')).toString('base64')}`),
    })
    const resolve = createSourceResolver({ target: port, cwd: CWD })
    expect(await resolve('http://localhost:4000/src/components/PlanCard.tsx?t=2', 20, 5)).toMatchObject({
      file: 'src/components/PlanCard.tsx',
      line: 8,
    })
    expect(await resolve('http://localhost:4000/@fs/home/me/app/lib/Card.tsx', 20, 5)).toMatchObject({ file: 'lib/Card.tsx' })
  })

  it('JS without a source map → null', async () => {
    const { port } = await upstream({ '/plain.js': js('') })
    expect(await createSourceResolver({ target: port, cwd: CWD })('http://localhost:4000/plain.js', 20, 5)).toBeNull()
  })

  it('upstream 404 → null', async () => {
    const { port } = await upstream({})
    expect(await createSourceResolver({ target: port, cwd: CWD })('http://localhost:4000/missing.js', 20, 5)).toBeNull()
  })

  it('unmapped position, garbage map, bad URL, unreachable upstream → null', async () => {
    const { port } = await upstream({
      '/a.js': js(`//# sourceMappingURL=data:application/json;base64,${Buffer.from(makeMap('src/x.ts')).toString('base64')}`),
      '/b.js': js('//# sourceMappingURL=data:application/json;base64,!!!notjson'),
    })
    const resolve = createSourceResolver({ target: port, cwd: CWD })
    expect(await resolve('http://localhost:4000/a.js', 1, 1)).toBeNull()
    expect(await resolve('http://localhost:4000/b.js', 20, 5)).toBeNull()
    expect(await resolve('not a url', 20, 5)).toBeNull()
    expect(await createSourceResolver({ target: 1, cwd: CWD })('http://localhost:4000/a.js', 20, 5)).toBeNull()
  })
})

describe('resolveSource via Next.js /__nextjs_source-map (webpack-internal and Server Component frames)', () => {
  const nextMap = (url: string) => '/__nextjs_source-map?' + new URLSearchParams({ filename: url })
  const RSC = 'about://React/Server/webpack-internal:///(rsc)/./components/PlanCard.tsx?13'

  it('asks the dev server for the map of a non-http frame URL and maps the position', async () => {
    const { port, hits } = await upstream({ [nextMap(RSC)]: makeMap('file:///home/me/app/components/PlanCard.tsx') })
    const resolve = createSourceResolver({ target: port, cwd: CWD })
    expect(await resolve(RSC, 20, 5)).toEqual({ file: 'components/PlanCard.tsx', line: 8, column: 10 })
    expect(hits).toEqual([nextMap(RSC)])
  })

  it('works for webpack-internal client modules and rsc:// frames too', async () => {
    const client = 'webpack-internal:///(app-pages-browser)/./src/Counter.tsx'
    const rsc = 'rsc://React/Server/file:///home/me/app/src/Card.tsx?3'
    const { port } = await upstream({
      [nextMap(client)]: makeMap('webpack://_N_E/./src/Counter.tsx'),
      [nextMap(rsc)]: makeMap('file:///home/me/app/src/Card.tsx'),
    })
    const resolve = createSourceResolver({ target: port, cwd: CWD })
    expect(await resolve(client, 20, 5)).toEqual({ file: 'src/Counter.tsx', line: 8, column: 10 })
    expect(await resolve(rsc, 20, 5)).toEqual({ file: 'src/Card.tsx', line: 8, column: 10 })
  })

  it('unknown module (Next answers 204/404) → null; other schemes are never fetched', async () => {
    const { port, hits } = await upstream({})
    const resolve = createSourceResolver({ target: port, cwd: CWD })
    expect(await resolve('webpack-internal:///(rsc)/./components/Nope.tsx', 20, 5)).toBeNull()
    expect(await resolve('javascript:alert(1)', 20, 5)).toBeNull()
    expect(await resolve('data:text/javascript,1', 20, 5)).toBeNull()
    expect(hits).toEqual([nextMap('webpack-internal:///(rsc)/./components/Nope.tsx')])
  })
})

describe('resolveSource SSRF guard', () => {
  it('never fetches another host via //host or backslash paths, or a protocol-relative map ref', async () => {
    const evil = await upstream({
      '/x.js': js(`//# sourceMappingURL=data:application/json;base64,${Buffer.from(makeMap('src/evil.ts')).toString('base64')}`),
      '/x.map': makeMap('src/evil.ts'),
    })
    const good = await upstream({ '/m.js': js(`//# sourceMappingURL=//127.0.0.1:${evil.port}/x.map`) })
    const resolve = createSourceResolver({ target: good.port, cwd: CWD })
    expect(await resolve(`http://localhost:4000//127.0.0.1:${evil.port}/x.js`, 20, 5)).toBeNull()
    expect(await resolve(`http://localhost:4000/\\127.0.0.1:${evil.port}/x.js`, 20, 5)).toBeNull()
    expect(await resolve(`http://localhost:4000/m.js`, 20, 5)).toBeNull()
    expect(evil.hits).toEqual([])
    expect(good.hits).toEqual([`//127.0.0.1:${evil.port}/x.js`, `//127.0.0.1:${evil.port}/x.js`, '/m.js', '/x.map'])
  })
})

describe('normalizeSourcePath', () => {
  it.each([
    ['webpack://_N_E/./src/a.tsx', 'src/a.tsx'],
    ['webpack:///./src/a.tsx', 'src/a.tsx'],
    ['file:///home/me/app/src/a.tsx', 'src/a.tsx'],
    ['./src/a.tsx?t=123', 'src/a.tsx'],
    ['/@fs/home/me/app/src/a.tsx', 'src/a.tsx'],
    ['\0/home/me/app/src/a.tsx', 'src/a.tsx'],
    ['/home/me/other/a.tsx', '/home/me/other/a.tsx'],
    ['/home/me/apple/a.tsx', '/home/me/apple/a.tsx'],
    ['src/a.tsx', 'src/a.tsx'],
  ])('%s → %s', (input, out) => {
    expect(normalizeSourcePath(input, CWD)).toBe(out)
  })
})
