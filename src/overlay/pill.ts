import type { ProgressEvent, QueueEntry, Snapshot } from '../../plugin/hooks/lib/types.ts'
import type { Api } from './api.ts'
import { PAUSED_LABEL } from '../../plugin/hooks/lib/queue.ts'

export type Tone = 'live' | 'wait' | 'ok' | 'idle' | 'off'
export type Summary = { text: string; tone: Tone }

const ACTIVE = new Set(['sent', 'running'])
const STATUS_TEXT: Record<QueueEntry['status'], string> = {
  queued: 'queued',
  sent: 'sent',
  running: 'running',
  done: 'done',
  aborted: 'interrupted',
  held: 'on hold',
}
const KIND_MARK: Record<ProgressEvent['kind'], string> = {
  tool: '·',
  'waiting-permission': '⏸',
  'turn-done': '✓',
  'turn-aborted': '✕',
  info: 'ℹ',
}
export const OFFLINE_TEXT = 'web-inspect: proxy isn’t running'
export const CONTINUE_HINT = 'Send a message in the terminal to continue'
export const QUEUED_PAUSED_TEXT = 'Queued. Send a message in the terminal to continue'
const TERMINAL = new Set<ProgressEvent['kind']>(['turn-done', 'turn-aborted', 'info'])

/** The mod is paused (after Esc, or holding a dropped submit) and waits for the user's input. */
function modPaused(s: Snapshot): boolean {
  if (s.queue.some((q) => q.status === 'held')) return true
  const end = [...s.progress].reverse().find((p) => TERMINAL.has(p.kind))
  return end?.kind === 'turn-aborted' || (end?.kind === 'info' && end.label === PAUSED_LABEL)
}

/** One-line collapsed pill text; null when nothing ever happened (pill hidden). */
export function summarize(s: Snapshot): Summary | null {
  const last = s.progress[s.progress.length - 1]
  // The latest one: an older orphan left sent/running must not freeze the pill.
  const active = [...s.queue].reverse().find((q) => ACTIVE.has(q.status))
  if (active) {
    if (last?.kind === 'waiting-permission') return { text: 'Waiting for approval in the terminal', tone: 'wait' }
    const tool = [...s.progress].reverse().find((p) => p.kind === 'tool' && p.instructionId === active.id)
    return { text: `Claude: ${tool ? tool.label : 'working'}…`, tone: 'live' }
  }
  const queued = s.queue.filter((q) => q.status === 'queued').length
  if (queued > 0) return modPaused(s) ? { text: QUEUED_PAUSED_TEXT, tone: 'wait' } : { text: `Queued: ${queued}`, tone: 'wait' }
  const finished = [...s.queue].reverse().find((q) => q.status === 'done' || q.status === 'aborted' || q.status === 'held')
  if (finished) return finished.status === 'done' ? { text: 'Done', tone: 'ok' } : { text: 'Interrupted', tone: 'idle' }
  if (last) return { text: last.label, tone: 'idle' }
  return null
}

export type Pill = { destroy(): void }

export function createPill(opts: { win: Window; doc: Document; dock: HTMLElement; api: Api; onChange(): void }): Pill {
  const { win, doc, dock, api } = opts
  let snapshot: Snapshot | null = null
  let offline = false
  let expanded = false

  const pill = doc.createElement('div')
  pill.className = 'pill'
  pill.setAttribute('aria-live', 'polite')

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => {
    const e = doc.createElement(tag)
    e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  function render() {
    const sum: Summary | null = offline ? { text: OFFLINE_TEXT, tone: 'off' } : snapshot && summarize(snapshot)
    if (!sum) {
      pill.remove()
      opts.onChange()
      return
    }
    pill.classList.toggle('off', offline)
    pill.replaceChildren()
    const head = el('button', 'pill-head')
    head.type = 'button'
    head.setAttribute('aria-expanded', String(expanded))
    head.title = expanded ? 'Collapse' : 'Show progress'
    const dot = el('span', `dot ${sum.tone === 'live' || sum.tone === 'wait' ? 'live' : sum.tone === 'ok' ? 'ok' : 'idle'}`)
    head.append(dot, el('span', 'pill-line', sum.text))
    head.addEventListener('click', () => {
      expanded = !expanded
      render()
    })
    pill.append(head)
    if (expanded && snapshot) pill.append(details(snapshot))
    if (!pill.isConnected) dock.append(pill)
    opts.onChange()
  }

  function details(s: Snapshot): HTMLElement {
    const log = el('div', 'log')
    const events = s.progress.slice(-8)
    if (events.length) {
      log.append(el('div', 'h', 'Progress'))
      for (const p of events) log.append(el('div', 'ev', `${KIND_MARK[p.kind] ?? '·'} ${p.label}`))
    }
    if (s.queue.length) {
      log.append(el('div', 'h', 'Queue'))
      for (const q of s.queue) {
        const row = el('div', 'q')
        row.append(el('span', 's', STATUS_TEXT[q.status] ?? q.status), el('span', 'sum', q.summary))
        if (q.status === 'aborted') {
          const b = el('button', 'resend', 'Send again')
          b.type = 'button'
          b.addEventListener('click', async () => {
            b.disabled = true
            // Non-2xx (e.g. 409: no longer resendable) is fine — the next snapshot shows the truth.
            await api.resend(q.id)
            if (b.isConnected) b.disabled = false
          })
          row.append(b)
        }
        if (q.status === 'aborted' || q.status === 'held') row.append(el('span', 'hint', CONTINUE_HINT))
        log.append(row)
      }
    }
    return log
  }

  const ES = (win as unknown as { EventSource?: typeof EventSource }).EventSource
  const source = ES ? new ES(api.eventsUrl) : null
  const onSnapshot = (e: MessageEvent) => {
    try {
      snapshot = JSON.parse(e.data) as Snapshot
      if (!Array.isArray(snapshot.queue) || !Array.isArray(snapshot.progress)) snapshot = null
    } catch {
      return
    }
    offline = false
    render()
  }
  if (source) {
    source.addEventListener('snapshot', onSnapshot as EventListener)
    // EventSource reconnects by itself; the server sends a fresh snapshot on connect.
    source.onerror = () => {
      offline = true
      render()
    }
  }

  return {
    destroy() {
      source?.close()
      pill.remove()
    },
  }
}
