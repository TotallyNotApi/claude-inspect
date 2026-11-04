import type { InstructionItem, SourceLoc } from '../../plugin/hooks/lib/types.ts'
import type { StackFrame } from './react.ts'

export const BASE = '/__web-inspect'

export type Api = {
  sendInstruction(pageUrl: string, items: InstructionItem[]): Promise<{ id: string }>
  /** Resolves true on 2xx; any other outcome (409, network) is false — never throws. */
  resend(id: string): Promise<boolean>
  /** Source location for a bundle stack frame, or undefined on failure/timeout. */
  resolveSource(frame: StackFrame, timeoutMs?: number): Promise<SourceLoc | undefined>
  eventsUrl: string
}

export function createApi(token: string): Api {
  const post = (path: string, body: unknown, signal?: AbortSignal) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-web-inspect-token': token },
      body: JSON.stringify(body),
      signal,
    })

  return {
    eventsUrl: `${BASE}/api/events?token=${encodeURIComponent(token)}`,
    async sendInstruction(pageUrl, items) {
      const res = await post('/api/instructions', { pageUrl, items })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as { id: string }
    },
    async resend(id) {
      try {
        return (await post('/api/resend', { id })).ok
      } catch {
        return false
      }
    },
    async resolveSource(frame, timeoutMs = 1500) {
      const ctrl = typeof AbortController === 'function' ? new AbortController() : undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          ctrl?.abort()
          resolve(undefined)
        }, timeoutMs)
      })
      const req = (async () => {
        try {
          const res = await post('/api/resolve-source', frame, ctrl?.signal)
          if (!res.ok) return undefined
          const loc = (await res.json()) as SourceLoc | null
          return loc && typeof loc.file === 'string' && typeof loc.line === 'number' ? loc : undefined
        } catch {
          return undefined
        }
      })()
      try {
        return await Promise.race([req, timeout])
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
