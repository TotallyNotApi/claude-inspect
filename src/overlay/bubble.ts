import { quickActionText } from '../../plugin/hooks/lib/format.ts'
import { icon, type IconName } from './icons.ts'
import { hoverLabel, placeBox } from './picker.ts'

export const DEFAULT_BATCH_NOTE = 'Adjust as needed.'
export const EDIT_PREFILL = 'Change this: '
export const PLACEHOLDER = 'Describe the change…'
export const SEND_FAILED = 'Couldn’t send. Is the proxy running?'
const GAP = 8
const MARGIN = 8
const MAX_FIELD_HEIGHT = 168

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
  bubble.setAttribute('aria-label', 'web-inspect: instruction for this element')

  const head = doc.createElement('div')
  head.className = 'bubble-head'
  const name = doc.createElement('span')
  name.className = 'el-name'
  const closeBtn = doc.createElement('button')
  closeBtn.type = 'button'
  closeBtn.className = 'icon-btn close'
  closeBtn.setAttribute('aria-label', 'Close (Esc)')
  closeBtn.append(icon(doc, 'close'))
  closeBtn.addEventListener('click', () => close())
  head.append(name, closeBtn)

  const field = doc.createElement('textarea')
  field.rows = 3
  field.placeholder = PLACEHOLDER
  field.setAttribute('aria-label', 'Instruction')

  const err = doc.createElement('div')
  err.className = 'err'
  err.setAttribute('role', 'alert')
  err.hidden = true

  const bar = doc.createElement('div')
  bar.className = 'bubble-bar'
  const actions = doc.createElement('div')
  actions.className = 'actions'
  const hint = doc.createElement('span')
  hint.className = 'hint'
  hint.textContent = '⏎ send · ⇧⏎ new line'
  const sendBtn = doc.createElement('button')
  sendBtn.type = 'button'
  sendBtn.className = 'icon-btn primary'
  sendBtn.setAttribute('aria-label', 'Send')
  sendBtn.dataset.tip = 'Send to Claude ⏎'
  sendBtn.append(icon(doc, 'send'))
  bar.append(actions, hint, sendBtn)

  bubble.append(head, field, err, bar)

  const buttons: HTMLButtonElement[] = [sendBtn]
  const action = (iconName: IconName, label: string, tip: string, run: () => void, extra = '') => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.className = `icon-btn ${extra}`.trim()
    b.setAttribute('aria-label', label)
    b.dataset.tip = tip
    b.append(icon(doc, iconName))
    b.addEventListener('click', run)
    buttons.push(b)
    actions.append(b)
  }

  const text = () => field.value.trim()
  const fit = () => {
    field.style.height = 'auto'
    field.style.height = `${Math.min(field.scrollHeight, MAX_FIELD_HEIGHT)}px`
  }
  const sync = () => {
    sendBtn.disabled = busy || !text()
  }

  const prefill = (value: string) => {
    field.value = value
    fit()
    sync()
    field.focus({ preventScroll: true })
    field.setSelectionRange(value.length, value.length)
  }

  let busy = false
  const setBusy = (on: boolean) => {
    busy = on
    for (const b of buttons) b.disabled = on
    field.readOnly = on
    bubble.classList.toggle('busy', on)
    sync()
  }

  const run = async (fn: (el: Element, text: string) => Promise<void>, value: string) => {
    const el = target
    if (!el || busy) return
    err.hidden = true
    setBusy(true)
    try {
      await fn(el, value)
      if (target === el) close()
    } catch {
      if (target === el) {
        err.textContent = SEND_FAILED
        err.hidden = false
      }
    } finally {
      setBusy(false)
    }
  }

  action('edit', 'Edit', 'Edit: describe what to change', () => prefill(EDIT_PREFILL))
  action('delete', 'Delete', 'Delete: sends right away', () => void run(handlers.send, quickActionText('delete')), 'danger')
  action('improve', 'Improve', 'Improve: prefills a suggestion', () => prefill(quickActionText('improve')))
  action('batch', 'Add to batch', 'Add to batch: the text becomes its note', () =>
    void run(handlers.addToBatch, text() || DEFAULT_BATCH_NOTE),
  )
  sendBtn.addEventListener('click', () => {
    if (text()) void run(handlers.send, text())
  })

  field.addEventListener('input', () => {
    fit()
    sync()
  })
  field.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return
    e.preventDefault()
    if (text() && !busy) void run(handlers.send, text())
  })
  // Keep typing in the bubble away from page hotkeys (our own window-capture handler runs first).
  for (const t of ['keydown', 'keyup', 'keypress']) bubble.addEventListener(t, (e) => e.stopPropagation())

  function reposition() {
    if (!target) return
    if (!target.isConnected) return close()
    const r = target.getBoundingClientRect()
    placeBox(sel, r)
    const w = bubble.offsetWidth || 340
    const h = bubble.offsetHeight || 160
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
      name.textContent = hoverLabel(el)
      name.title = name.textContent
      field.value = ''
      field.style.height = ''
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
