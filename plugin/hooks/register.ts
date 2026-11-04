// API shapes: UNVERIFIED — docs-based. `claude -p "/inspect" --plugin-dir ./plugin`
// ran the command OK but did not write plugin/.claude-plugin/types/claude-code/index.d.ts
// (needs an interactive session). Re-verify $.prompt.submit result, next.origin,
// $.session.cwd, tool.call/turn.complete fields.
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
import type { LaunchInfo } from './lib/types.ts'

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

async function stopProxy($: any): Promise<void> {
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

  on('session.end', async ($: any, e: any, next: any) => {
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
