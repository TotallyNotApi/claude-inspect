import { expect, test } from 'claude-code/testing'

const INFO = { port: 4000, token: 'tok', pid: 42, target: 3000 }

type Opts = { launch?: any; throws?: string; fetchFails?: boolean; fetchStatus?: number; stored?: Record<string, unknown> }
function stubs(on: any, o: Opts = {}) {
  const runs: any[] = []
  const fetches: any[] = []
  const statuses: any[] = []
  const stored: Record<string, unknown> = { ...(o.stored ?? {}) }
  const launch = o.launch ?? { exitCode: 0, stdout: JSON.stringify(INFO) + '\n', stderr: '' }
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'sess1' }))
  on('process.run', ($: any, e: any) => {
    runs.push(e)
    if (o.throws) return { deny: o.throws }
    return { value: launch }
  })
  on('http.fetch', ($: any, e: any) => {
    fetches.push(e)
    if (o.fetchFails) return { deny: 'ECONNREFUSED' }
    if (o.fetchStatus) return { value: { status: o.fetchStatus, ok: false, headers: {}, text: '{"error":"unauthorized"}' } }
    return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
  })
  on('store.get', ($: any, e: any) => ({ value: stored[e.key] }))
  on('store.set', ($: any, e: any) => { stored[e.key] = e.value; return { value: undefined } })
  on('store.delete', ($: any, e: any) => { delete stored[e.key]; return { value: undefined } })
  on('ui.status', ($: any, e: any) => { statuses.push(e); return { value: undefined } })
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'sess1' }))
  return { runs, fetches, statuses, stored }
}

async function boot($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
}
const run = ($: any, args: string) => $.command.run({ command: 'inspect', args })

const START_TEXT = 'otevři http://localhost:4000 (proxy pro localhost:3000). Výběr v prohlížeči: Alt+C.'
const NEG = 'neaktivní. Použij /inspect <port dev serveru>'

test('status when inactive', async ($: any, on: any) => {
  stubs(on)
  await boot($)
  expect((await run($, '')).text).toBe(NEG)
})

test('invalid port', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  expect((await run($, 'abc')).text).toBe('zadej port dev serveru, např. /inspect 3000')
  expect(S.runs.length).toBe(0)
})

test('start, status, stop', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  expect((await run($, '3000')).text).toBe(START_TEXT)
  expect(S.runs.length).toBe(1)
  const argv: string[] = S.runs[0].argv
  expect(argv[0]).toBe('node')
  expect(argv[1].endsWith('/plugin/server/launch.mjs')).toBe(true)
  expect(argv.slice(2)).toEqual(['--target', '3000', '--cwd', '/work'])
  expect(S.runs[0].init.timeoutMs).toBe(10000)
  expect(S.statuses[S.statuses.length - 1].text).toBe('inspect → :4000')
  expect((S.stored['proxy:sess1'] as any).token).toBe('tok')

  expect((await run($, '')).text).toBe('aktivní: http://localhost:4000 → :3000')

  expect((await run($, 'stop')).text).toBe('vypnuto')
  const f = S.fetches[S.fetches.length - 1]
  expect(f.url).toBe('http://127.0.0.1:4000/__web-inspect/api/shutdown')
  expect(f.init.method).toBe('POST')
  expect(f.init.headers['x-web-inspect-token']).toBe('tok')
  expect(S.statuses[S.statuses.length - 1].text).toBeUndefined()
  expect(S.stored['proxy:sess1']).toBeUndefined()
  expect((await run($, '')).text).toBe(NEG)
})

test('start while running stops the old one first', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  await run($, '3000')
  const before = S.fetches.length
  await run($, '3001')
  expect(S.fetches.length).toBe(before + 1)
  expect(S.fetches[before].url).toContain('/api/shutdown')
  expect(S.runs.length).toBe(2)
})

test('stop with nothing active', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  expect((await run($, 'stop')).text).toBe('vypnuto')
  expect(S.fetches.length).toBe(0)
})

test('stop clears state even when shutdown fetch rejects', async ($: any, on: any) => {
  const S = stubs(on, { fetchFails: true })
  await boot($)
  await run($, '3000')
  expect((await run($, 'stop')).text).toBe('vypnuto')
  expect(S.stored['proxy:sess1']).toBeUndefined()
  expect(S.statuses[S.statuses.length - 1].text).toBeUndefined()
  expect((await run($, '')).text).toBe(NEG)
})

test('launcher error json', async ($: any, on: any) => {
  stubs(on, { launch: { exitCode: 1, stdout: '{"error":"port busy"}\n', stderr: '' } })
  await boot($)
  expect((await run($, '3000')).text).toBe('nepodařilo se spustit proxy (port busy). Potřebuješ Node 20+.')
})

test('launcher garbage output', async ($: any, on: any) => {
  const S = stubs(on, { launch: { exitCode: 0, stdout: 'not json\n', stderr: '' } })
  await boot($)
  expect((await run($, '3000')).text).toBe(
    'nepodařilo se spustit proxy (neplatný výstup launcheru). Potřebuješ Node 20+.',
  )
  expect((await run($, '')).text).toBe(NEG)
  expect(S.stored['proxy:sess1']).toBeUndefined()
})

test('node missing (process.run rejects)', async ($: any, on: any) => {
  stubs(on, { throws: 'spawn node ENOENT' })
  await boot($)
  const t = (await run($, '3000')).text
  // The kit turns the { deny } stub into a rejection whose message is prefixed 'web-inspect: $.process.run: '.
  expect(t).toBe('nepodařilo se spustit proxy (web-inspect: $.process.run: spawn node ENOENT). Potřebuješ Node 20+.')
})

test('session.end fires shutdown and forgets the store key', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  await run($, '3000')
  const before = S.fetches.length
  await $.session.end({ reason: 'other' })
  expect(S.fetches.length).toBe(before + 1)
  expect(S.fetches[before].url).toBe('http://127.0.0.1:4000/__web-inspect/api/shutdown')
  expect(S.stored['proxy:sess1']).toBeUndefined()
})

test('session.start restores active from store', async ($: any, on: any) => {
  const S = stubs(on, { stored: { 'proxy:sess1': INFO } })
  await boot($)
  expect((await run($, '')).text).toBe('aktivní: http://localhost:4000 → :3000')
  expect(S.statuses[S.statuses.length - 1].text).toBe('inspect → :4000')
})

test('session.start checks the restored proxy live with a non-taking poll', async ($: any, on: any) => {
  const S = stubs(on, { stored: { 'proxy:sess1': INFO } })
  await boot($)
  expect(S.fetches.length).toBe(1)
  expect(S.fetches[0].url).toBe('http://127.0.0.1:4000/__web-inspect/api/poll')
  expect(JSON.parse(S.fetches[0].init.body)).toEqual({ canTake: false })
})

test('session.start drops a stored proxy that no longer answers', async ($: any, on: any) => {
  const S = stubs(on, { stored: { 'proxy:sess1': INFO }, fetchFails: true })
  await boot($)
  expect((await run($, '')).text).toBe(NEG)
  expect(S.stored['proxy:sess1']).toBeUndefined()
  expect(S.statuses.every((x) => x.text === undefined)).toBe(true)
})

test('session.start drops a stored proxy that answers 401 (another proxy on the port)', async ($: any, on: any) => {
  const S = stubs(on, { stored: { 'proxy:sess1': INFO }, fetchStatus: 401 })
  await boot($)
  expect((await run($, '')).text).toBe(NEG)
  expect(S.stored['proxy:sess1']).toBeUndefined()
})
