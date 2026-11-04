// API shapes: UNVERIFIED — docs-based. `claude -p "/inspect" --plugin-dir ./plugin`
// ran the command OK but did not write plugin/.claude-plugin/types/claude-code/index.d.ts
// (needs an interactive session). Re-verify $.prompt.submit result, next.origin,
// $.session.cwd, tool.call/turn.complete fields.
// Task 6 (test kit): $.plugin.name is a valid property. $.prompt.submit from the mod arrives at the
// prompt.submit stub with e.origin = { kind: "plugin", name: "web-inspect", asUser: true }, and is
// refused when called inside a prompt.submit hook ("called from a prompt.submit hook ...").
// Learned from the test kit: `$.plugin.root` is NOT a call ("plugin.root" is not an event),
// so it is a property (val() tolerates a function too). $.session.id()/cwd() MUST be called
// (reading them as values fails load). $.process.run, $.http.fetch, $.store.*, $.ui.status are stubbable calls.
import {
  parseInspectArgs,
  parseLaunchOutput,
  startText,
  statusText,
  statusLine,
  startFailedText,
  STOPPED_TEXT,
  INVALID_TEXT,
} from './lib/inspect.ts'
import { step } from './lib/queue.ts'
import type { Effect, QueueEvent, QueueState } from './lib/queue.ts'
import type { LaunchInfo } from './lib/types.ts'

const POLL_MS = 500

// Running proxy, mirrored in $.store under `proxy:<sessionId>` so it survives a hot reload.
let active: LaunchInfo | null = null

// $.plugin.root: property per the test kit; tolerate a function too.
async function val(x: any): Promise<any> {
  return typeof x === 'function' ? await x() : x
}

async function storeKey($: any): Promise<string> {
  return `proxy:${await $.session.id()}`
}

// POST to the running proxy's API. Throws if no proxy is active.
async function api($: any, path: string, body: unknown): Promise<any> {
  if (!active) throw new Error('web-inspect: proxy není aktivní')
  const r = await $.http.fetch(`http://127.0.0.1:${active.port}/__web-inspect/api/${path}`, {
    method: 'POST',
    headers: { 'x-web-inspect-token': active.token, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  try {
    return JSON.parse(r.text)
  } catch {
    return null
  }
}

// ---- Delivery of browser instructions (Task 6) ----
// Queue state machine (lib/queue.ts). Later hooks read `queue.phase` and `queue.current?.id`.
let queue: QueueState = { phase: 'idle' }
// The 500 ms poll timer; timers stop on module reload, so session.start restarts it.
let timer: { cancel(): void } | null = null
// Bumped whenever polling stops, so late results from an old run are ignored.
let generation = 0
// A heartbeat poll (canTake: false) is in flight; skip ticks until it answers.
let heartbeatPending = false
// Posts to /status and /progress go out one at a time, in dispatch order.
let postChain: Promise<unknown> = Promise.resolve()

function post($: any, path: string, body: unknown): Promise<unknown> {
  postChain = postChain.then(() => api($, path, body)).catch(() => {})
  return postChain
}

async function nowMs($: any): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

async function dispatch($: any, ev: QueueEvent): Promise<void> {
  const r = step(queue, ev)
  queue = r.state
  await runEffects($, r.effects)
}

async function runEffects($: any, effects: Effect[]): Promise<void> {
  const gen = generation
  for (const f of effects) {
    if (f.type === 'poll' && f.canTake) {
      let instruction = null
      try {
        const res = await api($, 'poll', { canTake: true })
        instruction = res?.instruction ?? null
      } catch {
        // Proxy down or not active: back to idle, try again next tick.
      }
      if (gen === generation) await dispatch($, { type: 'polled', instruction })
    } else if (f.type === 'poll') {
      if (heartbeatPending) continue
      heartbeatPending = true
      try {
        await api($, 'poll', { canTake: false })
      } catch {
      } finally {
        heartbeatPending = false
      }
    } else if (f.type === 'submit') {
      // Never awaited: it resolves only when the turn starts.
      let submitted: Promise<any>
      try {
        submitted = Promise.resolve($.prompt.submit({ text: f.text, asUser: true }))
      } catch (err) {
        submitted = Promise.reject(err)
      }
      submitted
        .then(
          (r: any): QueueEvent =>
            r && typeof r.drop === 'string' ? { type: 'submit-dropped', reason: r.drop } : { type: 'submitted' },
          (err: any): QueueEvent => ({ type: 'submit-dropped', reason: String(err?.message ?? err) }),
        )
        .then((ev: QueueEvent) => (gen === generation ? dispatch($, ev) : undefined))
        .catch(() => {})
    } else if (f.type === 'status') {
      await post($, 'status', { id: f.id, status: f.status })
    } else if (f.type === 'progress') {
      await post($, 'progress', { ...f.ev, at: await nowMs($) })
    }
  }
}

async function startPolling($: any): Promise<void> {
  stopPolling()
  const gen = generation
  try {
    timer = await $.clock.every(POLL_MS, () => {
      if (gen === generation && active) dispatch($, { type: 'tick' }).catch(() => {})
    })
  } catch {
    timer = null
  }
}

function stopPolling(): void {
  timer?.cancel()
  timer = null
  generation++
  queue = { phase: 'idle' }
  heartbeatPending = false
}

async function stopProxy($: any): Promise<void> {
  stopPolling()
  if (active) {
    try {
      await api($, 'shutdown', {})
    } catch {}
  }
  active = null
  try {
    await $.store.delete(await storeKey($))
  } catch {}
  await $.ui.status(undefined)
}

async function startProxy($: any, port: number): Promise<string> {
  if (active) await stopProxy($)
  let out: { exitCode: number; stdout: string; stderr: string }
  try {
    const root = await val($.plugin.root)
    const cwd = await $.session.cwd()
    out = await $.process.run(
      ['node', `${root}/server/launch.mjs`, '--target', String(port), '--cwd', cwd],
      { timeoutMs: 10000 },
    )
  } catch (err: any) {
    return startFailedText(String(err?.message ?? err))
  }
  const res = parseLaunchOutput(out.stdout, out.stderr)
  if (!res.ok) return startFailedText(res.reason)
  active = res.info
  await $.store.set(await storeKey($), res.info)
  await $.ui.status(statusLine(res.info))
  await startPolling($)
  return startText(res.info)
}

export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    await $.command.register({
      name: 'inspect',
      description: 'web-inspect: výběr elementů na dev webu',
      argumentHint: '[port|stop]',
      immediate: true,
    })
    try {
      const saved = await $.store.get(await storeKey($))
      if (saved && typeof saved.port === 'number') {
        active = saved
        await $.ui.status(statusLine(saved))
        await startPolling($)
      }
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'inspect' }, async ($: any, e: any) => {
    const a = parseInspectArgs(e.args)
    if (a.kind === 'invalid') return { text: INVALID_TEXT }
    if (a.kind === 'status') return { text: statusText(active) }
    if (a.kind === 'stop') {
      await stopProxy($)
      return { text: STOPPED_TEXT }
    }
    return { text: await startProxy($, a.port) }
  })

  // Only the main conversation's turns finish an instruction.
  on('turn.complete', async ($: any, e: any, next: any) => {
    if (e.agentId === undefined) dispatch($, { type: 'turn-complete', isAborted: !!e.isAborted }).catch(() => {})
    return next(e)
  })

  // Real user input lifts a pause after Esc. Not this mod's own $.prompt.submit (the kit and
  // Claude Code skip our hook for those as re-entry; e.origin = { kind: 'plugin', name, asUser }
  // is checked anyway), and not another mod's prompt either: only the user's input ends the hold.
  on('prompt.submit', async ($: any, e: any, next: any) => {
    const byEngine = (next.origin?.plugin ?? 'engine') === 'engine'
    if (active && queue.phase === 'paused' && byEngine && e.origin?.kind !== 'plugin') {
      // $.prompt.submit is refused inside a prompt.submit hook, so resubmit from a timer.
      Promise.resolve($.clock.after(0, () => dispatch($, { type: 'user-input' }))).catch(() => {})
    }
    return next(e)
  })

  on('session.end', async ($: any, e: any, next: any) => {
    stopPolling()
    if (active) {
      // Do not await: all session.end hooks share a 1.5 s budget.
      api($, 'shutdown', {}).catch(() => {})
      // Forget the dead proxy so a resumed session does not restore it.
      Promise.resolve()
        .then(async () => $.store.delete(await storeKey($)))
        .catch(() => {})
    }
    return next(e)
  })
}
