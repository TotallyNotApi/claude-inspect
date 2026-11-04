// Overlay entry: bundled to plugin/server/overlay.js and injected by the proxy as
// <script src="/__web-inspect/overlay.js?token=…" defer data-web-inspect>.
import type { InstructionItem } from '../../plugin/hooks/lib/types.ts'
import { createApi } from './api.ts'
import { createBatch } from './batch.ts'
import { createBubble } from './bubble.ts'
import { buildElementContext } from './context.ts'
import { createPicker } from './picker.ts'
import { createPill } from './pill.ts'
import { reactInfo } from './react.ts'
import { CSS } from './styles.ts'

/** Text-entry targets (page fields and the bubble's own textarea) keep Alt+C for typing. */
function isEditable(t: EventTarget | undefined): boolean {
  const el = t as HTMLElement | undefined
  if (!el || typeof el.tagName !== 'string') return false
  const tag = el.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  const ce = typeof el.closest === 'function' ? el.closest('[contenteditable]') : null
  return !!ce && ce.getAttribute('contenteditable')?.toLowerCase() !== 'false'
}

const TOGGLE_OFF = 'Výběr vypnut'
const TOGGLE_ON = 'Výběr zapnut'

export function mountOverlay(opts: { token: string; doc?: Document }): { destroy(): void } {
  const doc = opts.doc ?? document
  const win = doc.defaultView ?? window
  const api = createApi(opts.token)

  const host = doc.createElement('div')
  host.setAttribute('data-web-inspect-host', '')
  host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;'
  const shadow = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = CSS
  const ui = doc.createElement('div')
  ui.className = 'ui'
  const layer = doc.createElement('div') // boxes, labels, markers, bubble
  const toggle = doc.createElement('button')
  toggle.type = 'button'
  toggle.className = 'toggle'
  const dock = doc.createElement('div') // bottom-right: batch row + progress pill
  dock.className = 'stack'
  ui.append(layer, toggle, dock)
  shadow.append(style, ui)
  doc.body.append(host)

  async function buildItem(el: Element, instruction: string): Promise<InstructionItem> {
    const info = reactInfo(el)
    // A stackFrame is resolved through the proxy; an already-known source (exact, or approximate
    // for Next.js webpack-internal / Server Component frames) is the fallback.
    let source = info.source
    if (info.stackFrame) source = (await api.resolveSource(info.stackFrame)) ?? info.source
    return { instruction, element: { ...buildElementContext(el), components: info.components, ...(source ? { source } : {}) } }
  }

  const batch = createBatch({
    win,
    doc,
    layer,
    dock,
    send: async (items) => void (await api.sendInstruction(win.location.href, items)),
    onChange: () => updateDock(),
  })
  const bubble = createBubble({
    win,
    doc,
    layer,
    handlers: {
      send: async (el, text) => void (await api.sendInstruction(win.location.href, [await buildItem(el, text)])),
      addToBatch: async (el, text) => batch.add(await buildItem(el, text)),
    },
  })
  const picker = createPicker({ win, doc, host, layer, onPick: (el) => bubble.open(el) })
  const pill = createPill({ win, doc, dock, api, onChange: () => updateDock() })

  function updateDock() {
    dock.hidden = dock.childElementCount === 0
  }
  updateDock()

  function setPicking(on: boolean) {
    picker.setActive(on)
    if (!on) bubble.close()
    toggle.setAttribute('aria-pressed', String(on))
    toggle.title = on ? 'Vypnout výběr elementu (Alt+C)' : 'Zapnout výběr elementu (Alt+C)'
    const kbd = doc.createElement('b')
    kbd.textContent = 'Alt+C'
    toggle.replaceChildren(`◎ ${on ? TOGGLE_ON : TOGGLE_OFF} · `, kbd)
  }
  setPicking(false)
  toggle.addEventListener('click', () => setPicking(!picker.active))

  const onKey = (e: KeyboardEvent) => {
    // event.code: on macOS Alt+C produces key 'ç'.
    if (e.code === 'KeyC' && e.altKey && !e.ctrlKey && !e.metaKey) {
      if (e.repeat || isEditable(e.composedPath()[0])) return
      e.preventDefault()
      setPicking(!picker.active)
    } else if (e.key === 'Escape') {
      if (e.isComposing) return
      if (bubble.target) bubble.close()
      else if (picker.active) setPicking(false)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
  }
  win.addEventListener('keydown', onKey, true)

  // The Next.js dev indicator ("N", in <nextjs-portal>) sits bottom-left over the toggle chip.
  const placeToggle = () => toggle.classList.toggle('beside-next', !!doc.querySelector('nextjs-portal'))
  placeToggle()
  const portalWatch = new win.MutationObserver(placeToggle)
  portalWatch.observe(doc.body, { childList: true })

  let frame = 0
  const reposition = () => {
    frame = 0
    picker.reposition()
    bubble.reposition()
    batch.reposition()
  }
  const schedule = () => {
    if (!frame) frame = win.requestAnimationFrame(reposition)
  }
  win.addEventListener('scroll', schedule, { capture: true, passive: true })
  win.addEventListener('resize', schedule, { passive: true })
  // Re-renders/HMR move elements without scroll events; also re-attach the host if a framework wiped <body>.
  const timer = win.setInterval(() => {
    if (!host.isConnected && doc.body) {
      doc.body.append(host)
      portalWatch.observe(doc.body, { childList: true })
    }
    placeToggle()
    schedule()
  }, 1000)

  return {
    destroy() {
      win.clearInterval(timer)
      portalWatch.disconnect()
      if (frame) win.cancelAnimationFrame(frame)
      win.removeEventListener('keydown', onKey, true)
      win.removeEventListener('scroll', schedule, { capture: true })
      win.removeEventListener('resize', schedule)
      picker.destroy()
      bubble.destroy()
      batch.destroy()
      pill.destroy()
      host.remove()
    },
  }
}

function readToken(): string | null {
  const script = (document.currentScript as HTMLScriptElement | null) ?? document.querySelector('script[data-web-inspect]')
  const src = script?.getAttribute('src')
  if (!src) return null
  try {
    return new URL(src, location.href).searchParams.get('token')
  } catch {
    return null
  }
}

type Global = { __webInspect?: { destroy(): void } }
if (typeof window !== 'undefined' && typeof document !== 'undefined' && !(window as Global).__webInspect) {
  const token = readToken()
  if (token) {
    // Claim the guard synchronously so a second copy of the script never mounts twice.
    let mounted: { destroy(): void } | null = null
    let destroyed = false
    ;(window as Global).__webInspect = {
      destroy() {
        destroyed = true
        mounted?.destroy()
        delete (window as Global).__webInspect
      },
    }
    const start = () => {
      if (!destroyed) mounted = mountOverlay({ token })
    }
    if (document.body) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
  }
}
