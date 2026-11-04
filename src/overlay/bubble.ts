import { quickActionText } from '../../plugin/hooks/lib/format.ts'
import { placeBox } from './picker.ts'

export const DEFAULT_BATCH_NOTE = 'Uprav dle potřeby.'
const GAP = 8
const MARGIN = 8

export type BubbleHandlers = {
  /** Send one instruction for the element right away. */
  send(el: Element, instruction: string): Promise<void>
  /** Add the element to the batch. */
  addToBatch(el: Element, instruction: string): Promise<void>
}

export type Bubble = {
  readonly target: Element | null
  open(el: Element): void
  close(): void
  reposition(): void
  destroy(): void
}

export function createBubble(opts: { win: Window; doc: Document; layer: HTMLElement; handlers: BubbleHandlers }): Bubble {
  const { win, doc, layer, handlers } = opts
  let target: Element | null = null

  const sel = doc.createElement('div')
  sel.className = 'box sel-box'

  const bubble = doc.createElement('div')
  bubble.className = 'bubble'
  bubble.setAttribute('role', 'dialog')
  bubble.setAttribute('aria-label', 'web-inspect: instrukce pro element')

  const actions = doc.createElement('div')
  actions.className = 'actions'
  const field = doc.createElement('textarea')
  field.rows = 1
  field.placeholder = 'Vlastní instrukce… (⏎ pošle hned)'
  field.setAttribute('aria-label', 'Vlastní instrukce')
  const err = doc.createElement('div')
  err.className = 'err'
  err.setAttribute('role', 'alert')
  err.hidden = true
  bubble.append(actions, field, err)

  const buttons: HTMLButtonElement[] = []
  const chip = (text: string, title: string, run: () => void) => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = 'chip'
    b.textContent = text
    b.title = title
    b.addEventListener('click', run)
    buttons.push(b)
    actions.append(b)
  }

  const prefill = (text: string) => {
    field.value = text
    field.focus({ preventScroll: true })
    field.setSelectionRange(text.length, text.length)
  }

  const run = async (fn: (el: Element, text: string) => Promise<void>, text: string) => {
    const el = target
    if (!el) return
    setBusy(true)
    try {
      await fn(el, text)
      if (target === el) close()
    } catch {
      if (target === el) {
        err.textContent = 'Nepodařilo se odeslat – běží proxy?'
        err.hidden = false
      }
    } finally {
      setBusy(false)
    }
  }

  const setBusy = (busy: boolean) => {
    for (const b of buttons) b.disabled = busy
    field.readOnly = busy
  }

  chip('✏️ Upravit', 'Napiš, co upravit', () => prefill('Uprav: '))
  chip('🗑 Smazat', 'Pošle hned: smazat element', () => void run(handlers.send, quickActionText('delete')))
  chip('✨ Vylepšit', 'Předvyplní instrukci k vylepšení', () => prefill(quickActionText('improve')))
  chip('＋ Do dávky', 'Přidá element do dávky (text pole jako poznámka)', () =>
    void run(handlers.addToBatch, field.value.trim() || DEFAULT_BATCH_NOTE),
  )

  field.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    e.preventDefault()
    const text = field.value.trim()
    if (text && !field.readOnly) void run(handlers.send, text)
  })
  // Keep typing in the bubble away from page hotkeys (our own window-capture handler runs first).
  for (const t of ['keydown', 'keyup', 'keypress']) bubble.addEventListener(t, (e) => e.stopPropagation())

  function reposition() {
    if (!target) return
    if (!target.isConnected) return close()
    const r = target.getBoundingClientRect()
    placeBox(sel, r)
    const w = bubble.offsetWidth || 304
    const h = bubble.offsetHeight || 90
    const vh = win.innerHeight
    const vw = win.innerWidth
    let top = r.bottom + GAP
    if (top + h > vh - MARGIN) top = r.top - h - GAP
    top = Math.max(MARGIN, Math.min(top, vh - h - MARGIN))
    const left = Math.max(MARGIN, Math.min(r.left, vw - w - MARGIN))
    bubble.style.top = `${top}px`
    bubble.style.left = `${left}px`
  }

  function close() {
    target = null
    sel.remove()
    bubble.remove()
  }

  return {
    get target() {
      return target
    },
    open(el) {
      target = el
      field.value = ''
      err.hidden = true
      setBusy(false)
      layer.append(sel, bubble)
      reposition()
      field.focus({ preventScroll: true })
    },
    close,
    reposition,
    destroy: close,
  }
}
