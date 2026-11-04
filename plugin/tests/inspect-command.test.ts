import { expect, test } from 'claude-code/testing'

const INFO = { port: 4000, token: 'tok', pid: 42, target: 3000 }

type Opts = { launch?: any; throws?: string; stored?: Record<string, unknown> }
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

test('status when inactive', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  const r = await run($, '')
  expect(JSON.stringify(r)).toContain('neaktivní. Použij /inspect <port dev serveru>')
})

test('invalid port', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  const r = await run($, 'abc')
  expect(JSON.stringify(r)).toContain('web-inspect: zadej port dev serveru, např. /inspect 3000')
  expect(S.runs.length).toBe(0)
})

test('start, status, stop', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  const r = await run($, '3000')
  expect(JSON.stringify(r)).toContain(
    'web-inspect: otevři http://localhost:4000 (proxy pro localhost:3000). Výběr v prohlížeči: Alt+C.',
  )
  expect(S.runs.length).toBe(1)
  expect(JSON.stringify(S.runs[0])).toContain('/plugin/server/launch.mjs')
  expect(JSON.stringify(S.runs[0])).toContain('"--target","3000","--cwd","/work"')
  expect(JSON.stringify(S.statuses)).toContain('inspect → :4000')
  expect(JSON.stringify(S.stored['proxy:sess1'])).toContain('tok')

  const s = await run($, '')
  expect(JSON.stringify(s)).toContain('aktivní: http://localhost:4000 → :3000')

  const x = await run($, 'stop')
  expect(JSON.stringify(x)).toContain('web-inspect: vypnuto')
  const f = S.fetches[S.fetches.length - 1]
  expect(f.url).toBe('http://127.0.0.1:4000/__web-inspect/api/shutdown')
  expect(JSON.stringify(f)).toContain('x-web-inspect-token')
  expect(S.stored['proxy:sess1']).toBeUndefined()
  expect(JSON.stringify(await run($, ''))).toContain('neaktivní')
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

test('launcher error json', async ($: any, on: any) => {
  stubs(on, { launch: { exitCode: 1, stdout: '{"error":"port busy"}\n', stderr: '' } })
  await boot($)
  const r = await run($, '3000')
  expect(JSON.stringify(r)).toContain('web-inspect: nepodařilo se spustit proxy (port busy). Potřebuješ Node 20+.')
})

test('node missing (process.run rejects)', async ($: any, on: any) => {
  stubs(on, { throws: 'spawn node ENOENT' })
  await boot($)
  const r = await run($, '3000')
  expect(JSON.stringify(r)).toContain('nepodařilo se spustit proxy (')
  expect(JSON.stringify(r)).toContain('Potřebuješ Node 20+.')
})

test('session.end fires shutdown', async ($: any, on: any) => {
  const S = stubs(on)
  await boot($)
  await run($, '3000')
  const before = S.fetches.length
  await $.session.end({ reason: 'other' })
  expect(S.fetches.length).toBe(before + 1)
  expect(S.fetches[before].url).toContain('/api/shutdown')
})

test('session.start restores active from store', async ($: any, on: any) => {
  stubs(on, { stored: { 'proxy:sess1': INFO } })
  await boot($)
  expect(JSON.stringify(await run($, ''))).toContain('aktivní: http://localhost:4000 → :3000')
})
