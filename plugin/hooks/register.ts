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
  lostStatusLine,
  lostNotice,
  startFailedText,
  STOPPED_TEXT,
  INVALID_TEXT,
} from './lib/inspect.ts'
import { toolLabel } from './lib/progress.ts'
import { step } from './lib/queue.ts'
import type { Effect, QueueEvent, QueueState } from './lib/queue.ts'
import type { LaunchInfo } from './lib/types.ts'

const POLL_MS = 500
// Consecutive failed polls/heartbeats (~4 s at 500 ms ticks) after which the proxy counts as dead.
const MAX_FAILURES = 8

// Running proxy, mirrored in $.store under `proxy:<sessionId>` so it survives a hot reload.
let active: LaunchInfo | null = null
// The proxy stopped answering (not stopped by the user); /inspect reports it until a start or stop.
let lost = false
// Consecutive poll/heartbeat failures.
let failures = 0

// $.plugin.root: property per the test kit; tolerate a function too.
async function val(x: any): Promise<any> {
  return typeof x === 'function' ? await x() : x
}

async function storeKey($: any): Promise<string> {
  return `proxy:${await $.session.id()}`
}

// POST to a proxy's API. Throws on network errors and on any non-2xx answer (e.g. 401: a
// different proxy now owns the port).
async function apiTo($: any, info: LaunchInfo, path: string, body: unknown): Promise<any> {
  const r = await $.http.fetch(`http://127.0.0.1:${info.port}/__web-inspect/api/${path}`, {
    method: 'POST',
    headers: { 'x-web-inspect-token': info.token, 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!r || typeof r.status !== 'number' || r.status < 200 || r.status > 299)
    throw new Error(`web-inspect: proxy answered HTTP ${r?.status}`)
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

// POST to the running proxy's API. Throws if no proxy is active.
async function api($: any, path: string, body: unknown): Promise<any> {
  if (!active) throw new Error('web-inspect: proxy isn’t active')
  return apiTo($, active, path, body)
}

// Runs an API call after every earlier queued post; the result (or error) goes to the caller.
function chained($: any, path: string, body: unknown): Promise<any> {
  const p = postChain.then(() => api($, path, body))
  postChain = p.catch(() => {})
  return p
}

function post($: any, path: string, body: unknown): Promise<unknown> {
  return chained($, path, body).catch(() => {})
}

// Counts poll/heartbeat outcomes; true when this failure declared the proxy dead.
async function noteHealth($: any, ok: boolean): Promise<boolean> {
  if (ok) {
    failures = 0
    return false
  }
  failures++
  if (failures < MAX_FAILURES || !active) return false
  await proxyLost($)
  return true
}

// The proxy is gone (crashed, killed, watchdog after sleep): stop, forget it and tell the user once.
async function proxyLost($: any): Promise<void> {
  const info = active
  stopPolling()
  active = null
  lost = true
  if (!info) return
  try {
    await $.store.delete(await storeKey($))
  } catch {}
  try {
    await $.ui.status(lostStatusLine(info))
  } catch {}
  try {
    await $.ui.toast(lostNotice(info))
  } catch {}
}

async function nowMs($: any): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

// Progress for the overlay. Never awaited and never allowed to throw: a tool call must not notice it.
function reportProgress($: any, kind: 'tool' | 'waiting-permission', label: string): void {
  if (!active || queue.phase !== 'running') return
  const instructionId = queue.current?.id
  nowMs($)
    .then((at) => post($, 'progress', { kind, label, instructionId, at }))
    .catch(() => {})
}

// Error handler for the progress hooks (docs: events.md "Handle a hook that fails"). A hook that failed
// after next() resolved keeps that result: next(e) in the handler replays it without running anything
// downstream again. One that failed before next() is skipped by Claude Code; calling next(e) here does the
// same (fail open), since progress must never block a tool call or turn a decision into a denial.
async function progressCatch($: any, e: any, next: any): Promise<any> {
  // Same call for both cases: next.called true replays the recorded result, false fails open.
  return next(e)
}

// Error handler for the prompt.submit hook: same fail-open rule, so the user's prompt is never lost.
async function promptCatch($: any, e: any, next: any): Promise<any> {
  return next(e)
}

// Restores a proxy saved before a hot reload, after one live non-taking poll; a dead or foreign
// one (network error, 401) is forgotten.
async function restoreProxy($: any): Promise<void> {
  const key = await storeKey($)
  const saved = await $.store.get(key)
  if (!saved || typeof saved.port !== 'number') return
  let alive = false
  try {
    await apiTo($, saved, 'poll', { canTake: false })
    alive = true
  } catch {}
  if (!alive) {
    await $.store.delete(key)
    return
  }
  active = saved
  await $.ui.status(statusLine(saved))
  await startPolling($)
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
      let ok = false
      try {
        // Chained after pending status posts: the proxy aborts whatever is still sent/running when
        // asked to take, so the previous instruction's `done` must arrive first.
        const res = await chained($, 'poll', { canTake: true })
        instruction = res?.instruction ?? null
        ok = true
      } catch {
        // Proxy down or not active: back to idle, try again next tick. If the response was lost
        // after the proxy's take, the next take marks that orphan aborted.
      }
      if (gen !== generation) return
      if (await noteHealth($, ok)) return
      await dispatch($, { type: 'polled', instruction })
    } else if (f.type === 'poll') {
      if (heartbeatPending) continue
      heartbeatPending = true
      let ok = false
      try {
        await api($, 'poll', { canTake: false })
        ok = true
      } catch {
      } finally {
        heartbeatPending = false
      }
      if (gen !== generation) return
      if (await noteHealth($, ok)) return
    } else if (f.type === 'submit') {
      // Never awaited. Docs: $.prompt.submit "waits until the session is idle and then starts a new
      // turn. It resolves when that turn starts."
      // (https://code.claude.com/docs/en/plugins/mods/api.md#start-a-turn-from-a-background-job)
      // So a resolved non-drop result maps to `submitted` (running). Re-checked live in Task 11.
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
  failures = 0
}

async function stopProxy($: any): Promise<void> {
  stopPolling()
  lost = false
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
  lost = false
  await $.store.set(await storeKey($), res.info)
  await $.ui.status(statusLine(res.info))
  await startPolling($)
  return startText(res.info)
}

export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    await $.command.register({
      name: 'inspect',
      description: 'web-inspect: pick elements on your dev site',
      argumentHint: '[port|stop]',
      immediate: true,
    })
    try {
      await restoreProxy($)
    } catch {}
    return next(e)
  })

  on('command.run', { command: 'inspect' }, async ($: any, e: any) => {
    const a = parseInspectArgs(e.args)
    if (a.kind === 'invalid') return { text: INVALID_TEXT }
    if (a.kind === 'status') return { text: statusText(active, lost) }
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

  on('tool.call', async ($: any, e: any, next: any) => {
    try {
      if (e.agentId === undefined) reportProgress($, 'tool', toolLabel(String(e.tool), e))
    } catch {}
    return next(e)
  }).catch(progressCatch)

  on('tool.check', async ($: any, e: any, next: any) => {
    const r = await next(e)
    try {
      if (e.agentId === undefined && r?.decision === 'ask')
        reportProgress($, 'waiting-permission', 'Waiting for approval in the terminal')
    } catch {}
    return r
  }).catch(progressCatch)

  // Real user input lifts a pause after Esc. Decided only from the kit-verified e.origin: a prompt
  // from any mod (this one's own $.prompt.submit skips this hook as re-entry anyway) arrives with
  // e.origin = { kind: 'plugin', name, asUser }; only the user's input ends the hold.
  on('prompt.submit', async ($: any, e: any, next: any) => {
    try {
      if (active && queue.phase === 'paused' && e.origin?.kind !== 'plugin') {
        // $.prompt.submit is refused inside a prompt.submit hook, so resubmit from a timer.
        Promise.resolve($.clock.after(0, () => dispatch($, { type: 'user-input' }).catch(() => {}))).catch(() => {})
      }
    } catch {}
    return next(e)
  }).catch(promptCatch)

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
