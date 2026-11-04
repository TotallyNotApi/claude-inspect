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
  return { ok: false, reason: (stderr ?? '').trim() || 'neplatný výstup launcheru' }
}

export const STOPPED_TEXT = 'web-inspect: vypnuto'
export const INVALID_TEXT = 'web-inspect: zadej port dev serveru, např. /inspect 3000'

export const startText = (i: LaunchInfo) =>
  `web-inspect: otevři http://localhost:${i.port} (proxy pro localhost:${i.target}). Výběr v prohlížeči: Alt+C.`
export const statusText = (i: LaunchInfo | null) =>
  i ? `aktivní: http://localhost:${i.port} → :${i.target}` : 'neaktivní. Použij /inspect <port dev serveru>'
export const startFailedText = (reason: string) =>
  `web-inspect: nepodařilo se spustit proxy (${reason}). Potřebuješ Node 20+.`
export const statusLine = (i: LaunchInfo) => `inspect → :${i.port}`
