import { isGeneratedClass } from './context.ts'
import { reactInfo } from './react.ts'

// Events the page must not see while picking (capture phase on window).
const BLOCKED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu'] as const

export type Picker = {
  readonly active: boolean
  setActive(on: boolean): void
  reposition(): void
  destroy(): void
}

export function isFromOverlay(e: Event, host: Element): boolean {
  return typeof e.composedPath === 'function' ? e.composedPath().includes(host) : host.contains(e.target as Node)
}

function eventElement(e: Event, doc: Document): Element | null {
  const t = (typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target) as Node | null
  const el = t && t.nodeType === 1 ? (t as Element) : (t?.parentElement ?? null)
  if (!el || el === doc.documentElement || el === doc.body) return null
  return el
}

export function shortName(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const cls = Array.from(el.classList).find((c) => !isGeneratedClass(c))
  return cls ? `${tag}.${cls}` : tag
}

/** `div.plan · PlanCard (PlanCard.tsx:8)` — only cheap, already-known info (no network). */
export function hoverLabel(el: Element): string {
  const info = reactInfo(el)
  const src = info.source ? ` (${info.source.file.split('/').pop()}:${info.source.line})` : ''
  const comp = info.components[0]
  return shortName(el) + (comp ? ` · ${comp}${src}` : src)
}

export function placeBox(box: HTMLElement, r: DOMRect, pad = 2): void {
  box.style.left = `${r.left - pad}px`
  box.style.top = `${r.top - pad}px`
  box.style.width = `${r.width + pad * 2}px`
  box.style.height = `${r.height + pad * 2}px`
}

export function createPicker(opts: {
  win: Window
  doc: Document
  host: Element
  layer: HTMLElement
  onPick(el: Element): void
}): Picker {
  const { win, doc, host, layer } = opts
  let active = false
  let hovered: Element | null = null
  let labelFor: Element | null = null
  let frame = 0

  const box = doc.createElement('div')
  box.className = 'box hover-box'
  const label = doc.createElement('div')
  label.className = 'hover-label'

  const hide = () => {
    hovered = null
    box.remove()
    label.remove()
  }

  const render = () => {
    frame = 0
    const el = hovered
    if (!active || !el || !el.isConnected) return hide()
    if (labelFor !== el) {
      label.textContent = hoverLabel(el)
      labelFor = el
    }
    if (!box.isConnected) layer.append(box, label)
    const r = el.getBoundingClientRect()
    placeBox(box, r)
    const lw = label.offsetWidth || 0
    const above = r.top - 20
    label.style.top = `${above >= 2 ? above : Math.min(r.bottom + 4, win.innerHeight - 20)}px`
    label.style.left = `${Math.max(2, Math.min(r.left, win.innerWidth - lw - 2))}px`
  }

  const onMove = (e: Event) => {
    if (!active) return
    const el = isFromOverlay(e, host) ? null : eventElement(e, doc)
    if (!el) return hide()
    hovered = el
    // Synchronous first paint keeps tests (and the very first hover) simple; later moves are rAF-throttled.
    if (!box.isConnected) render()
    else if (!frame) frame = win.requestAnimationFrame(render)
  }

  const onBlocked = (e: Event) => {
    if (!active || isFromOverlay(e, host)) return
    e.preventDefault()
    e.stopImmediatePropagation()
    if (e.type === 'click') {
      const el = eventElement(e, doc)
      if (el) opts.onPick(el)
    }
  }

  const onLeave = (e: MouseEvent) => {
    if (!e.relatedTarget) hide()
  }

  win.addEventListener('mousemove', onMove, { capture: true, passive: true })
  doc.addEventListener('mouseout', onLeave as EventListener, true)
  for (const t of BLOCKED) win.addEventListener(t, onBlocked, true)

  return {
    get active() {
      return active
    },
    setActive(on) {
      active = on
      if (!on) hide()
    },
    reposition: () => hovered && render(),
    destroy() {
      if (frame) win.cancelAnimationFrame(frame)
      win.removeEventListener('mousemove', onMove, { capture: true })
      doc.removeEventListener('mouseout', onLeave as EventListener, true)
      for (const t of BLOCKED) win.removeEventListener(t, onBlocked, true)
      hide()
    },
  }
}
