import { expect, mock, test } from 'claude-code/testing'
import { formatInstruction } from '../hooks/lib/format.ts'
import type { Instruction } from '../hooks/lib/types.ts'

const INFO = { port: 4000, token: 'tok', pid: 42, target: 3000 }
const STOPPED = 'the session was stopped and nobody has sent input since'
const I: Instruction = {
  id: 'i1', createdAt: 0, pageUrl: 'http://localhost:4000/pricing',
  items: [{ instruction: 'Zvětši nadpis', element: {
    text: 'Ceník', tag: 'h1', attrs: {}, domPath: 'main > h1', selector: 'h1', components: [], outerHTML: '<h1>Ceník</h1>',
  } }],
}

type Opts = {
  // What each $.prompt.submit call made by the mod resolves to, in order (last one repeats).
  submitResults?: any[]
  // Instructions the proxy hands out to polls with canTake, in order.
  instructions?: Instruction[]
  pollFails?: boolean
  // HTTP status the proxy answers polls with (non-2xx counts as a failure).
  pollStatus?: number
  // Poll fails for the call numbers in this set (1-based).
  failPollsAt?: Set<number>
  // Mock milliseconds a poll takes to answer.
  pollDelayMs?: number
}

function stubs(on: any, o: Opts = {}) {
  const clock = mock.clock(on)
  const posts: { path: string; body: any }[] = []
  const submits: any[] = []
  const typed: any[] = []
  const uiStatus: any[] = []
  const toasts: any[] = []
  const logs: any[] = []
  let pollCount = 0
  const toHand = [...(o.instructions ?? [I])]
  const results = o.submitResults ?? [undefined]
  let n = 0
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 'sess1' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: JSON.stringify(INFO) + '\n', stderr: '' } }))
  on('http.fetch', async ($: any, e: any) => {
    const path = String(e.url).replace('http://127.0.0.1:4000/__web-inspect/api/', '')
    const body = JSON.parse(e.init.body)
    posts.push({ path, body })
    if (path === 'poll') {
      if (o.pollDelayMs) await clock.sleep(o.pollDelayMs)
      pollCount++
      if (o.pollFails || o.failPollsAt?.has(pollCount)) return { deny: 'ECONNREFUSED' }
      if (o.pollStatus) return { value: { status: o.pollStatus, ok: false, headers: {}, text: '{"error":"unauthorized"}' } }
      const instruction = body.canTake ? toHand.shift() ?? null : null
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ instruction }) } }
    }
    return { value: { status: 200, ok: true, headers: {}, text: '{"ok":true}' } }
  })
  const stored: Record<string, unknown> = {}
  on('store.get', ($: any, e: any) => ({ value: stored[e.key] }))
  on('store.set', ($: any, e: any) => { stored[e.key] = e.value; return { value: undefined } })
  on('store.delete', ($: any, e: any) => { delete stored[e.key]; return { value: undefined } })
  on('ui.status', ($: any, e: any) => { uiStatus.push(e); return { value: undefined } })
  on('ui.toast', ($: any, e: any) => { toasts.push(e); return { value: undefined } })
  on('ui.log', ($: any, e: any) => { logs.push(e); return { value: undefined } })
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.end', () => ({ sessionId: 'sess1' }))
  on('turn.complete', () => ({ text: '' }))
  on('prompt.submit', ($: any, e: any) => {
    // The mod's own $.prompt.submit arrives with e.origin = { kind: 'plugin', name: 'web-inspect', asUser: true }.
    if (e.origin?.name === 'web-inspect') {
      submits.push(e)
      const r = results[Math.min(n++, results.length - 1)]
      return r ?? { text: e.text }
    }
    typed.push(e)
    return { text: e.text }
  })
  const statuses = () => posts.filter((p) => p.path === 'status').map((p) => p.body.status)
  const progress = () => posts.filter((p) => p.path === 'progress').map((p) => p.body)
  const polls = () => posts.filter((p) => p.path === 'poll').map((p) => p.body.canTake)
  return { clock, posts, submits, typed, statuses, progress, polls, uiStatus, toasts, logs, stored }
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'inspect', args: '3000' })
}
async function complete($: any, S: { clock: any }, isAborted: boolean) {
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 10, isAborted, usage: null })
  await S.clock.settle()
}

test('delivers a polled instruction once and reports done', async ($: any, on: any) => {
  const S = stubs(on)
  await start($)
  expect(S.posts.length).toBe(0)
  await S.clock.advance(500)
  await S.clock.settle()
  expect(S.submits.length).toBe(1)
  expect(S.submits[0].text).toBe(formatInstruction(I))
  expect(S.submits[0].origin).toEqual({ kind: 'plugin', name: 'web-inspect', asUser: true })
  expect(S.statuses()).toEqual(['sent', 'running'])
  for (let k = 0; k < 3; k++) await S.clock.advance(500)
  expect(S.submits.length).toBe(1)
  // While running, ticks are heartbeats that never take an instruction.
  expect(S.polls()).toEqual([true, false, false, false])
  await complete($, S, false)
  expect(S.statuses()).toEqual(['sent', 'running', 'done'])
  const p = S.progress()
  expect(p.length).toBe(1)
  expect(p[0]).toEqual({ kind: 'turn-done', label: 'Hotovo', instructionId: 'i1', at: S.clock.now() })
  // Back to idle: the next tick may take an instruction again.
  await S.clock.advance(500)
  expect(S.polls()).toEqual([true, false, false, false, true])
})

test('a dropped submit holds the instruction until the user types', async ($: any, on: any) => {
  const S = stubs(on, { submitResults: [{ drop: STOPPED }, undefined] })
  await start($)
  await S.clock.advance(500)
  await S.clock.settle()
  expect(S.submits.length).toBe(1)
  expect(S.statuses()).toEqual(['sent', 'held'])
  expect(S.progress().map((x) => x.label)).toEqual(['Přerušeno – pokračuj zprávou v terminálu'])
  await S.clock.advance(500)
  expect(S.polls()).toEqual([true, false])
  // The user's own message resumes delivery of the same text.
  await $.prompt.submit({ text: 'pokračuj' })
  await S.clock.settle()
  expect(S.typed.length).toBe(1)
  expect(S.submits.length).toBe(2)
  expect(S.submits[1].text).toBe(formatInstruction(I))
  expect(S.statuses()).toEqual(['sent', 'held', 'running'])
})

test('a prompt with no plugin origin while paused resubmits the held instruction', async ($: any, on: any) => {
  const S = stubs(on, { submitResults: [{ drop: STOPPED }, undefined] })
  await start($)
  await S.clock.advance(500)
  await S.clock.settle()
  await $.prompt.submit({ text: 'pokračuj' })
  await S.clock.settle()
  expect(S.submits.length).toBe(2)
  expect(S.submits[1].text).toBe(formatInstruction(I))
})

test('a prompt from a mod does not lift the hold', async ($: any, on: any) => {
  const S = stubs(on, { submitResults: [{ drop: STOPPED }, undefined] })
  await start($)
  await S.clock.advance(500)
  await S.clock.settle()
  await $.prompt.submit({ text: 'od jiného modu', origin: { kind: 'plugin', name: 'other-mod' } })
  await S.clock.advance(500)
  await S.clock.settle()
  expect(S.submits.length).toBe(1)
  expect(S.statuses()).toEqual(['sent', 'held'])
})

test('an aborted turn is not resent and waits for user input', async ($: any, on: any) => {
  const S = stubs(on, { instructions: [I, { ...I, id: 'i2' }] })
  await start($)
  await S.clock.advance(500)
  await S.clock.settle()
  await complete($, S, true)
  expect(S.statuses()).toEqual(['sent', 'running', 'aborted'])
  expect(S.progress().map((x) => [x.kind, x.label])).toEqual([['turn-aborted', 'Přerušeno']])
  await S.clock.advance(500)
  expect(S.polls()).toEqual([true, false])
  expect(S.submits.length).toBe(1)
  await $.prompt.submit({ text: 'jiná věc' })
  await S.clock.advance(500)
  await S.clock.settle()
  expect(S.submits.length).toBe(2)
  expect(S.submits[1].text).toBe(formatInstruction({ ...I, id: 'i2' }))
})

test('subagent turn completions are ignored', async ($: any, on: any) => {
  const S = stubs(on)
  await start($)
  await S.clock.advance(500)
  await S.clock.settle()
  await $.turn.complete({ turnId: 't2', answer: '', durationMs: 1, isAborted: false, usage: null, agentId: 'a1' })
  await S.clock.settle()
  expect(S.statuses()).toEqual(['sent', 'running'])
})

test('a poll still pending when the next tick fires is not repeated', async ($: any, on: any) => {
  // The poll answers only after 2 s of mock time.
  const S = stubs(on, { instructions: [], pollDelayMs: 2000 })
  await start($)
  for (let k = 0; k < 3; k++) await S.clock.advance(500)
  expect(S.polls()).toEqual([true])
  await S.clock.advance(1000)
  await S.clock.settle()
  await S.clock.advance(500)
  expect(S.polls()).toEqual([true, true])
})

test('proxy down: failed polls keep the queue idle without throwing', async ($: any, on: any) => {
  const S = stubs(on, { pollFails: true })
  await start($)
  for (let k = 0; k < 3; k++) await S.clock.advance(500)
  expect(S.polls()).toEqual([true, true, true])
  expect(S.submits.length).toBe(0)
})

const LOST_STATUS = 'inspect: proxy spadla – /inspect 3000'
const LOST_TEXT = 'proxy neběží. Použij /inspect <port dev serveru>'

test('proxy death: 8 failed polls in a row stop polling, clear state and tell the user once', async ($: any, on: any) => {
  const S = stubs(on, { pollFails: true })
  await start($)
  for (let k = 0; k < 7; k++) await S.clock.advance(500)
  await S.clock.settle()
  expect(S.toasts.length + S.logs.length).toBe(0)
  expect((await $.command.run({ command: 'inspect', args: '' })).text).toBe('aktivní: http://localhost:4000 → :3000')
  await S.clock.advance(500)
  await S.clock.settle()
  expect(S.polls().length).toBe(8)
  expect(S.uiStatus[S.uiStatus.length - 1].text).toBe(LOST_STATUS)
  expect(S.stored['proxy:sess1']).toBeUndefined()
  expect((await $.command.run({ command: 'inspect', args: '' })).text).toBe(LOST_TEXT)
  expect(S.toasts.length + S.logs.length).toBe(1)
  for (let k = 0; k < 5; k++) await S.clock.advance(500)
  await S.clock.settle()
  expect(S.polls().length).toBe(8)
  expect(S.toasts.length + S.logs.length).toBe(1)
  // Starting again clears the lost state.
  await $.command.run({ command: 'inspect', args: '3000' })
  expect((await $.command.run({ command: 'inspect', args: '' })).text).toBe('aktivní: http://localhost:4000 → :3000')
})

test('proxy death: non-2xx answers (401 after a restart) count as failures too', async ($: any, on: any) => {
  const S = stubs(on, { pollStatus: 401 })
  await start($)
  for (let k = 0; k < 8; k++) await S.clock.advance(500)
  await S.clock.settle()
  expect((await $.command.run({ command: 'inspect', args: '' })).text).toBe(LOST_TEXT)
  expect(S.uiStatus[S.uiStatus.length - 1].text).toBe(LOST_STATUS)
})

test('proxy death: heartbeat failures while running count, and a success resets the count', async ($: any, on: any) => {
  // Poll 1 takes the instruction; polls 2-7 fail, 8 succeeds, 9-15 fail (7 in a row), 16 is the 8th.
  const S = stubs(on, { failPollsAt: new Set([2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16]) })
  await start($)
  for (let k = 0; k < 15; k++) await S.clock.advance(500)
  await S.clock.settle()
  expect(S.polls()[0]).toBe(true)
  expect(S.polls().slice(1).every((x) => x === false)).toBe(true)
  expect((await $.command.run({ command: 'inspect', args: '' })).text).toBe('aktivní: http://localhost:4000 → :3000')
  await S.clock.advance(500)
  await S.clock.settle()
  expect((await $.command.run({ command: 'inspect', args: '' })).text).toBe(LOST_TEXT)
})

test('stop after a proxy death reports plain inactive again', async ($: any, on: any) => {
  const S = stubs(on, { pollFails: true })
  await start($)
  for (let k = 0; k < 8; k++) await S.clock.advance(500)
  await S.clock.settle()
  expect((await $.command.run({ command: 'inspect', args: 'stop' })).text).toBe('vypnuto')
  expect((await $.command.run({ command: 'inspect', args: '' })).text).toBe('neaktivní. Použij /inspect <port dev serveru>')
  expect(S.uiStatus[S.uiStatus.length - 1].text).toBeUndefined()
})

test('stop cancels polling', async ($: any, on: any) => {
  const S = stubs(on)
  await start($)
  await $.command.run({ command: 'inspect', args: 'stop' })
  const before = S.posts.length
  for (let k = 0; k < 3; k++) await S.clock.advance(500)
  expect(S.posts.length).toBe(before)
})

test('polling resumes after a reload when the proxy is restored from the store', async ($: any, on: any) => {
  const clock = mock.clock(on)
  const polls: any[] = []
  on('session.id', () => ({ value: 'sess1' }))
  on('store.get', () => ({ value: INFO }))
  on('ui.status', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('session.start', () => ({ cwd: '/work' }))
  on('http.fetch', ($$: any, e: any) => {
    polls.push(JSON.parse(e.init.body))
    return { value: { status: 200, ok: true, headers: {}, text: '{"instruction":null}' } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  // One live check before restoring, then regular polling.
  expect(polls).toEqual([{ canTake: false }])
  await clock.advance(500)
  expect(polls).toEqual([{ canTake: false }, { canTake: true }])
})
