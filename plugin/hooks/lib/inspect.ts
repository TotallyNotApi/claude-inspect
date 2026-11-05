import type { LaunchInfo } from './types.ts'

export type InspectArgs =
  | { kind: 'start'; port: number }
  | { kind: 'stop' }
  | { kind: 'status' }
  | { kind: 'invalid' }

export function parseInspectArgs(args: string): InspectArgs {
  const a = (args ?? '').trim()
  if (a === '') return { kind: 'status' }
  if (a === 'stop') return { kind: 'stop' }
  if (/^\d+$/.test(a)) {
    const port = Number(a)
    if (port >= 1 && port <= 65535) return { kind: 'start', port }
  }
  return { kind: 'invalid' }
}

export type LaunchResult = { ok: true; info: LaunchInfo } | { ok: false; reason: string }

export function parseLaunchOutput(stdout: string, stderr = ''): LaunchResult {
  const line = (stdout ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
  try {
    const j = JSON.parse(line)
    if (j && typeof j.error === 'string') return { ok: false, reason: j.error }
    if (j && typeof j.port === 'number' && typeof j.token === 'string') {
      return { ok: true, info: { port: j.port, token: j.token, pid: j.pid, target: j.target } }
    }
  } catch {}
  return { ok: false, reason: (stderr ?? '').trim() || 'invalid launcher output' }
}

export const STOPPED_TEXT = 'stopped'
export const INVALID_TEXT = 'give the dev server port, e.g. /inspect 3000'

export const startText = (i: LaunchInfo) =>
  `open http://localhost:${i.port} (proxy for localhost:${i.target}). Pick elements with ⌘C on macOS, Alt+C elsewhere.`
export const LOST_TEXT = 'proxy isn’t running. Use /inspect <dev server port>'
/** `lost`: the proxy stopped answering (it was not stopped with /inspect stop). */
export const statusText = (i: LaunchInfo | null, lost = false) =>
  i ? `active: http://localhost:${i.port} → :${i.target}` : lost ? LOST_TEXT : 'inactive. Use /inspect <dev server port>'
export const startFailedText = (reason: string) =>
  `couldn’t start the proxy (${reason}). Node 20+ is required.`
export const statusLine = (i: LaunchInfo) => `inspect → :${i.port}`
export const lostStatusLine = (i: LaunchInfo) => `inspect: proxy died, /inspect ${i.target}`
export const lostNotice = (i: LaunchInfo) =>
  `the proxy at http://localhost:${i.port} stopped responding. Start it again: /inspect ${i.target}`
