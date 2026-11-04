import type { InstructionItem } from '../../plugin/hooks/lib/types.ts'
import { placeBox } from './picker.ts'

export const BATCH_KEY = 'web-inspect:batch'
const SEND_FAILED = 'Nepodařilo se odeslat – běží proxy?'

function storage(win: Window): Storage | null {
  try {
    return win.sessionStorage
  } catch {
    return null
  }
}

export function loadBatch(win: Window): InstructionItem[] {
  try {
    const v = JSON.parse(storage(win)?.getItem(BATCH_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((i) => i && typeof i.instruction === 'string' && i.element) : []
  } catch {
    return []
  }
}

function saveBatch(win: Window, items: InstructionItem[]): void {
  try {
    const s = storage(win)
    if (!s) return
    if (items.length) s.setItem(BATCH_KEY, JSON.stringify(items))
    else s.removeItem(BATCH_KEY)
  } catch {}
}

export type Batch = {
  readonly items: InstructionItem[]
  add(item: InstructionItem): void
  reposition(): void
  destroy(): void
}

export function createBatch(opts: {
  win: Window
  doc: Document
  layer: HTMLElement
  dock: HTMLElement
  send(items: InstructionItem[]): Promise<void>
  onChange(): void
}): Batch {
  const { win, doc, layer, dock } = opts
  let items = loadBatch(win)
  let sending = false
  let marks: { box: HTMLElement; marker: HTMLButtonElement }[] = []

  const row = doc.createElement('div')
  row.className = 'batch'
  const count = doc.createElement('b')
  const sep = doc.createElement('span')
  sep.className = 'sep'
  sep.textContent = ' · '
  const sendBtn = doc.createElement('button')
  sendBtn.type = 'button'
  sendBtn.className = 'send'
  sendBtn.textContent = 'Odeslat'
  const err = doc.createElement('span')
  err.className = 'err'
  err.setAttribute('role', 'alert')
  err.textContent = SEND_FAILED
  err.hidden = true
  row.append(count, sep, sendBtn, err)

  sendBtn.addEventListener('click', async () => {
    if (sending || !items.length) return
    sending = true
    sendBtn.disabled = true
    err.hidden = true
    const sent = items
    try {
      await opts.send(sent)
      items = items.filter((i) => !sent.includes(i))
      saveBatch(win, items)
      render()
    } catch {
      err.hidden = false
    } finally {
      sending = false
      sendBtn.disabled = false
    }
  })

  const remove = (item: InstructionItem) => {
    items = items.filter((i) => i !== item)
    saveBatch(win, items)
    render()
  }

  function render() {
    for (const m of marks) {
      m.box.remove()
      m.marker.remove()
    }
    marks = items.map((item, n) => {
      const box = doc.createElement('div')
      box.className = 'box batch-box'
      const marker = doc.createElement('button')
      marker.type = 'button'
      marker.className = 'marker'
      marker.setAttribute('aria-label', `Položka ${n + 1}: ${item.instruction} – odebrat z dávky`)
      marker.title = `${item.instruction}\n× odebrat z dávky`
      const num = doc.createElement('span')
      num.className = 'n'
      num.textContent = String(n + 1)
      const x = doc.createElement('span')
      x.className = 'x'
      x.textContent = '×'
      marker.append(num, x)
      marker.addEventListener('click', () => remove(item))
      layer.append(box, marker)
      return { box, marker }
    })
    if (items.length) {
      count.textContent = `Dávka (${items.length})`
      if (!row.isConnected) dock.prepend(row)
    } else row.remove()
    reposition()
    opts.onChange()
  }

  function reposition() {
    marks.forEach(({ box, marker }, n) => {
      let el: Element | null = null
      try {
        el = doc.querySelector(items[n].element.selector)
      } catch {}
      // Re-found by selector every time: survives re-renders/HMR; hidden while not on the page.
      const r = el?.getBoundingClientRect()
      const visible = !!r && (r.width > 0 || r.height > 0)
      box.hidden = marker.hidden = !visible
      if (!r || !visible) return
      placeBox(box, r)
      marker.style.left = `${Math.max(0, Math.min(r.right - 9, win.innerWidth - 18))}px`
      marker.style.top = `${Math.max(0, r.top - 9)}px`
    })
  }

  render()

  return {
    get items() {
      return items
    },
    add(item) {
      items = [...items, item]
      saveBatch(win, items)
      render()
    },
    reposition,
    destroy() {
      for (const m of marks) {
        m.box.remove()
        m.marker.remove()
      }
      marks = []
      row.remove()
    },
  }
}
