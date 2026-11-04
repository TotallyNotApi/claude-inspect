import type { ProgressEvent, QueueEntry, Snapshot } from '../../plugin/hooks/lib/types.ts'
import type { Api } from './api.ts'

export type Tone = 'live' | 'wait' | 'ok' | 'idle' | 'off'
export type Summary = { text: string; tone: Tone }

const ACTIVE = new Set(['sent', 'running'])
const STATUS_TEXT: Record<QueueEntry['status'], string> = {
  queued: 've frontě',
  sent: 'odesláno',
  running: 'běží',
  done: 'hotovo',
  aborted: 'přerušeno',
  held: 'pozdrženo',
}
const KIND_MARK: Record<ProgressEvent['kind'], string> = {
  tool: '·',
  'waiting-permission': '⏸',
  'turn-done': '✓',
  'turn-aborted': '✕',
  info: 'ℹ',
}
export const OFFLINE_TEXT = 'web-inspect: proxy neběží'
export const CONTINUE_HINT = 'Pokračuj zprávou v terminálu'

/** One-line collapsed pill text; null when nothing ever happened (pill hidden). */
export function summarize(s: Snapshot): Summary | null {
  const last = s.progress[s.progress.length - 1]
  const active = s.queue.find((q) => ACTIVE.has(q.status))
  if (active) {
    if (last?.kind === 'waiting-permission') return { text: 'Čeká na schválení v terminálu', tone: 'wait' }
    const tools = s.progress.filter((p) => p.kind === 'tool')
    const tool = [...tools].reverse().find((p) => p.instructionId === active.id) ?? tools[tools.length - 1]
    return { text: `Claude: ${tool ? tool.label : 'pracuje'}…`, tone: 'live' }
  }
  const queued = s.queue.filter((q) => q.status === 'queued').length
  if (queued > 0) return { text: `Ve frontě: ${queued}`, tone: 'wait' }
  const finished = [...s.queue].reverse().find((q) => q.status === 'done' || q.status === 'aborted' || q.status === 'held')
  if (finished) return finished.status === 'done' ? { text: 'Hotovo', tone: 'ok' } : { text: 'Přerušeno', tone: 'idle' }
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
    head.title = expanded ? 'Sbalit' : 'Rozbalit průběh'
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
      log.append(el('div', 'h', 'Průběh'))
      for (const p of events) log.append(el('div', 'ev', `${KIND_MARK[p.kind] ?? '·'} ${p.label}`))
    }
    if (s.queue.length) {
      log.append(el('div', 'h', 'Fronta'))
      for (const q of s.queue) {
        const row = el('div', 'q')
        row.append(el('span', 's', STATUS_TEXT[q.status] ?? q.status), el('span', 'sum', q.summary))
        if (q.status === 'aborted') {
          const b = el('button', 'resend', 'Poslat znovu')
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
