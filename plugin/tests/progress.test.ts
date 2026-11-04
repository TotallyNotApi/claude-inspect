import { expect, mock, test } from 'claude-code/testing'
import { toolLabel } from '../hooks/lib/progress.ts'

const INFO = { port: 4000, token: 'tok', pid: 42, target: 3000 }
const I = {
  id: 'i1', createdAt: 0, pageUrl: 'http://localhost:4000/pricing',
  items: [{ instruction: 'x', element: { text: 'a', tag: 'h1', attrs: {}, domPath: 'h1', selector: 'h1', components: [], outerHTML: '<h1>a</h1>' } }],
}

test('toolLabel: Read', () => {
  expect(toolLabel('Read', { file_path: '/x/src/Pricing.tsx' })).toBe('čte Pricing.tsx')
  expect(toolLabel('Read', { file_path: 'C:\\x\\Pricing.tsx' })).toBe('čte Pricing.tsx')
})
test('toolLabel: edits', () => {
  for (const t of ['Edit', 'Write', 'MultiEdit'])
    expect(toolLabel(t, { file_path: '/x/a/B.tsx' })).toBe('upravuje B.tsx')
  expect(toolLabel('NotebookEdit', { notebook_path: '/x/n.ipynb' })).toBe('upravuje n.ipynb')
})
test('toolLabel: Bash truncates to 40 chars', () => {
  expect(toolLabel('Bash', { command: 'npm test' })).toBe('spouští npm test')
  expect(toolLabel('Bash', { command: 'a'.repeat(60) })).toBe('spouští ' + 'a'.repeat(40))
})
test('toolLabel: search, agents, others, missing input', () => {
  expect(toolLabel('Grep', { pattern: 'foo' })).toBe('hledá foo')
  expect(toolLabel('Glob', { pattern: '**/*.ts' })).toBe('hledá **/*.ts')
  expect(toolLabel('Agent', {})).toBe('spouští subagenta')
  expect(toolLabel('Task', {})).toBe('spouští subagenta')
  expect(toolLabel('WebFetch', {})).toBe('používá WebFetch')
  expect(toolLabel('Read', {})).toBe('používá Read')
  expect(toolLabel('Bash', {})).toBe('používá Bash')
})

function stubs(on: any, o: { fetchFails?: boolean; decision?: string } = {}) {
  const posts: { path: string; body: any }[] = []
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'sess1' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(INFO) + '\n', stderr: '' } }))
  on('http.fetch', async ($: any, e: any) => {
    const path = String(e.url).replace('http://127.0.0.1:4000/__web-inspect/api/', '')
    const body = JSON.parse(e.init.body)
    if (path === 'progress' && o.fetchFails) return { deny: 'ECONNREFUSED' }
    posts.push({ path, body })
    const instruction = path === 'poll' && body.canTake ? I : null
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ instruction }) } }
  })
  const stored: Record<string, unknown> = {}
  on('store.get', ($: any, e: any) => ({ value: stored[e.key] }))
  on('store.set', ($: any, e: any) => { stored[e.key] = e.value; return { value: undefined } })
  on('store.delete', ($: any, e: any) => { delete stored[e.key]; return { value: undefined } })
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
  on('tool.call', () => ({ result: 'ok' }))
  on('tool.check', () => ({ decision: o.decision ?? 'allow' }))
  const progress = () => posts.filter((p) => p.path === 'progress').map((p) => p.body)
  return { posts, progress }
}

async function startRunning($: any, clock: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'inspect', args: '3000' })
  await clock.advance(500)
  await clock.settle()
}


test('tool.call posts a tool progress event while running', async ($: any, on: any) => {
  const clock = mock.clock(on)
  const S = stubs(on)
  await startRunning($, clock)
  const r = await $.tool.call({ tool: 'Edit', file_path: '/x/src/Pricing.tsx' })
  await clock.settle()
  expect(r).toEqual({ result: 'ok' })
  expect(S.progress().map((p) => [p.kind, p.label, p.instructionId])).toEqual([['tool', 'upravuje Pricing.tsx', 'i1']])
})

test('tool.call posts nothing when no proxy is active', async ($: any, on: any) => {
  const clock = mock.clock(on)
  const S = stubs(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: 'Edit', file_path: '/x/a.tsx' })
  await clock.settle()
  expect(S.posts.length).toBe(0)
})

test('subagent tool calls are not reported', async ($: any, on: any) => {
  const clock = mock.clock(on)
  const S = stubs(on)
  await startRunning($, clock)
  await $.tool.call({ tool: 'Edit', file_path: '/x/a.tsx', agentId: 'a1' })
  await clock.settle()
  expect(S.progress().length).toBe(0)
})

test('a failing progress post never breaks the tool call', async ($: any, on: any) => {
  const clock = mock.clock(on)
  const S = stubs(on, { fetchFails: true })
  await startRunning($, clock)
  const r = await $.tool.call({ tool: 'Read', file_path: '/x/a.tsx' })
  await clock.settle()
  expect(r).toEqual({ result: 'ok' })
  expect(S.progress().length).toBe(0)
})

test('tool.check ask reports waiting-permission and returns the decision', async ($: any, on: any) => {
  const clock = mock.clock(on)
  const S = stubs(on, { decision: 'ask' })
  await startRunning($, clock)
  const r = await $.tool.check({ tool: 'Bash', command: 'rm -rf x' })
  await clock.settle()
  expect(r.decision).toBe('ask')
  expect(S.progress().map((p) => [p.kind, p.label, p.instructionId])).toEqual([
    ['waiting-permission', 'Čeká na schválení v terminálu', 'i1'],
  ])
})

test('tool.check allow reports nothing', async ($: any, on: any) => {
  const clock = mock.clock(on)
  const S = stubs(on, { decision: 'allow' })
  await startRunning($, clock)
  const r = await $.tool.check({ tool: 'Bash', command: 'ls' })
  await clock.settle()
  expect(r.decision).toBe('allow')
  expect(S.progress().length).toBe(0)
})
