// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountOverlay } from '../../src/overlay/index.ts'
import type { Snapshot } from '../../plugin/hooks/lib/types.ts'

const FIXTURE = `
<main>
  <section id="pricing">
    <h2>Ceník</h2>
    <div class="plans">
      <div class="plan">Basic <b>0 Kč</b></div>
      <div class="plan"><span class="badge">Nejoblíbenější</span> Pro <b>290 Kč</b></div>
      <div class="plan">Team <b>990 Kč</b></div>
    </div>
  </section>
</main>`

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onerror: ((e: Event) => void) | null = null
  onopen: ((e: Event) => void) | null = null
  closed = false
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>()
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  removeEventListener() {}
  close() {
    this.closed = true
  }
  emitSnapshot(s: Snapshot) {
    for (const fn of this.listeners.get('snapshot') ?? []) fn({ data: JSON.stringify(s) } as MessageEvent)
  }
}

type Call = { url: string; body: any; headers: Record<string, string> }
let calls: Call[]
let fetchMock: ReturnType<typeof vi.fn>
let overlay: { destroy(): void }

const host = () => document.querySelector('[data-web-inspect-host]') as HTMLElement
const root = () => host().shadowRoot!
const $ = (sel: string) => root().querySelector(sel) as HTMLElement | null
const badge = () => document.querySelector('span.badge') as HTMLElement
const button = (text: string) =>
  Array.from(root().querySelectorAll('button')).find((b) => b.textContent!.includes(text)) as HTMLButtonElement | undefined
const instructionCalls = () => calls.filter((c) => c.url.endsWith('/api/instructions'))

function key(code: string, init: KeyboardEventInit = {}, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent('keydown', { code, key: init.key ?? code, bubbles: true, composed: true, ...init }))
}
const altC = () => key('KeyC', { altKey: true, key: 'ç' })
const esc = () => key('Escape', { key: 'Escape' })
function click(el: Element) {
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }))
}
function pick(el: Element) {
  altC()
  click(el)
}

beforeEach(() => {
  document.body.innerHTML = FIXTURE
  sessionStorage.clear()
  FakeEventSource.instances = []
  ;(window as any).EventSource = FakeEventSource
  calls = []
  fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers ?? {}) as Record<string, string> })
    if (url.endsWith('/api/instructions')) return new Response(JSON.stringify({ id: 'i1' }), { status: 200 })
    if (url.endsWith('/api/resend')) return new Response(JSON.stringify({ ok: true }), { status: 200 })
    return new Response('null', { status: 200 })
  })
  ;(window as any).fetch = fetchMock
  overlay = mountOverlay({ token: 'tok' })
})

afterEach(() => {
  overlay.destroy()
})

describe('mount', () => {
  it('creates a shadow host with max z-index and the toggle', () => {
    expect(host()).toBeTruthy()
    expect(host().style.zIndex).toBe('2147483647')
    expect(button('Výběr vypnut')!.textContent).toBe('◎ Výběr vypnut · Alt+C')
  })
  it('moves the toggle chip out of the way of the Next.js dev indicator (nextjs-portal), also when it appears later', async () => {
    const toggle = () => $('.toggle')!
    expect(toggle().classList.contains('beside-next')).toBe(false)
    const portal = document.createElement('nextjs-portal')
    document.body.append(portal)
    await vi.waitFor(() => expect(toggle().classList.contains('beside-next')).toBe(true))
    portal.remove()
    await vi.waitFor(() => expect(toggle().classList.contains('beside-next')).toBe(false))
    document.body.append(document.createElement('nextjs-portal'))
    overlay.destroy()
    overlay = mountOverlay({ token: 'tok' })
    expect(toggle().classList.contains('beside-next')).toBe(true)
  })
  it('destroy removes host, listeners and closes the EventSource', () => {
    const spy = vi.fn()
    badge().addEventListener('click', spy)
    overlay.destroy()
    expect(host()).toBeNull()
    expect(FakeEventSource.instances[0].closed).toBe(true)
    altC()
    click(badge())
    expect(spy).toHaveBeenCalledTimes(1)
    overlay = mountOverlay({ token: 'tok' }) // for afterEach
  })
})

describe('picker', () => {
  it('Alt+C turns picking on and the page does not receive the click', () => {
    const spy = vi.fn()
    badge().addEventListener('click', spy)
    badge().onclick = spy
    altC()
    expect(button('Výběr zapnut')!.textContent).toBe('◎ Výběr zapnut · Alt+C')
    click(badge())
    expect(spy).not.toHaveBeenCalled()
  })
  it('without picking mode clicks go through', () => {
    const spy = vi.fn()
    badge().addEventListener('click', spy)
    click(badge())
    expect(spy).toHaveBeenCalledTimes(1)
    expect($('.bubble')).toBeNull()
  })
  it('hover shows the label tag.class', () => {
    altC()
    badge().dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }))
    expect($('.hover-label')!.textContent).toBe('span.badge')
  })
  it('click opens the bubble with four actions and the field', () => {
    pick(badge())
    const bubble = $('.bubble')!
    expect(bubble).toBeTruthy()
    for (const t of ['✏️ Upravit', '🗑 Smazat', '✨ Vylepšit', '＋ Do dávky']) expect(button(t)).toBeTruthy()
    const field = bubble.querySelector('textarea')!
    expect(field.getAttribute('placeholder')).toBe('Vlastní instrukce… (⏎ pošle hned)')
  })
  it('clicking an overlay element does not select it', () => {
    altC()
    click(button('Výběr zapnut')!)
    expect($('.bubble')).toBeNull()
    // and the toggle still works as a button: it turned picking off
    expect(button('Výběr vypnut')).toBeTruthy()
  })
  it('Esc closes the bubble, the second Esc turns picking off', () => {
    pick(badge())
    esc()
    expect($('.bubble')).toBeNull()
    expect(button('Výběr zapnut')).toBeTruthy()
    esc()
    expect(button('Výběr vypnut')).toBeTruthy()
  })
  it('Alt+C typed into a page field, textarea, select or contenteditable does not toggle picking', () => {
    const input = document.createElement('input')
    const area = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    const inner = document.createElement('span')
    editable.append(inner)
    document.body.append(input, area, select, editable)
    for (const t of [input, area, select, editable, inner]) {
      key('KeyC', { altKey: true, key: 'ç' }, t)
      expect(button('Výběr vypnut'), t.tagName).toBeTruthy()
    }
  })
  it("Alt+C in the bubble's own textarea does not toggle picking", () => {
    pick(badge())
    const field = $('.bubble textarea')!
    key('KeyC', { altKey: true, key: 'ç' }, field)
    expect(button('Výběr zapnut')).toBeTruthy()
    expect($('.bubble')).toBeTruthy()
  })
  it('a repeated Alt+C keydown (key held) is ignored', () => {
    key('KeyC', { altKey: true, key: 'ç', repeat: true })
    expect(button('Výběr vypnut')).toBeTruthy()
  })
  it('Esc during IME composition does nothing', () => {
    pick(badge())
    key('Escape', { key: 'Escape', isComposing: true })
    expect($('.bubble')).toBeTruthy()
  })
})

describe('bubble actions', () => {
  it('🗑 Smazat sends the delete instruction with element context', async () => {
    pick(badge())
    button('🗑 Smazat')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    const c = instructionCalls()[0]
    expect(c.url).toBe('/__web-inspect/api/instructions')
    expect(c.headers['x-web-inspect-token']).toBe('tok')
    expect(c.headers['content-type']).toBe('application/json')
    expect(c.body.pageUrl).toBe(location.href)
    expect(c.body.items).toHaveLength(1)
    expect(c.body.items[0].instruction).toBe('Smaž tento element.')
    expect(c.body.items[0].element.domPath).toBe('main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge')
    expect(c.body.items[0].element.components).toEqual([])
    await vi.waitFor(() => expect($('.bubble')).toBeNull())
    expect(button('Výběr zapnut')).toBeTruthy()
  })
  it('✏️ Upravit prefills "Uprav: " and focuses the field', () => {
    pick(badge())
    button('✏️ Upravit')!.click()
    const field = $('.bubble textarea') as HTMLTextAreaElement
    expect(field.value).toBe('Uprav: ')
    expect(root().activeElement).toBe(field)
  })
  it('✨ Vylepšit prefills the improve text', () => {
    pick(badge())
    button('✨ Vylepšit')!.click()
    expect(($('.bubble textarea') as HTMLTextAreaElement).value).toBe(
      'Vylepši tento element (vzhled, texty, přístupnost) v duchu zbytku stránky.',
    )
  })
  it('Enter sends the custom text, Shift+Enter does not', async () => {
    pick(badge())
    const field = $('.bubble textarea') as HTMLTextAreaElement
    field.value = 'Změň barvu na zelenou'
    key('Enter', { key: 'Enter', shiftKey: true }, field)
    await new Promise((r) => setTimeout(r, 20))
    expect(instructionCalls()).toHaveLength(0)
    key('Enter', { key: 'Enter' }, field)
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    expect(instructionCalls()[0].body.items[0].instruction).toBe('Změň barvu na zelenou')
  })
  it('Enter with an empty field sends nothing', async () => {
    pick(badge())
    const field = $('.bubble textarea') as HTMLTextAreaElement
    key('Enter', { key: 'Enter' }, field)
    await new Promise((r) => setTimeout(r, 20))
    expect(instructionCalls()).toHaveLength(0)
  })
})

describe('batch', () => {
  it('two ＋ Do dávky → storage has 2 items, pill shows Dávka (2) · Odeslat, sending posts once', async () => {
    pick(badge())
    ;($('.bubble textarea') as HTMLTextAreaElement).value = 'Zvětši'
    button('＋ Do dávky')!.click()
    await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(1))
    click(document.querySelector('h2')!)
    button('＋ Do dávky')!.click()
    await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(2))
    const stored = JSON.parse(sessionStorage.getItem('web-inspect:batch')!)
    expect(stored[0].instruction).toBe('Zvětši')
    expect(stored[1].instruction).toBe('Uprav dle potřeby.')
    expect($('.batch')!.textContent).toContain('Dávka (2) · Odeslat')
    expect(root().querySelectorAll('.marker')).toHaveLength(2)
    expect(instructionCalls()).toHaveLength(0)

    button('Odeslat')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    expect(instructionCalls()[0].body.items).toHaveLength(2)
    await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(0))
    expect($('.batch')).toBeNull()
    expect(root().querySelectorAll('.marker')).toHaveLength(0)
  })
  it('restores the batch from sessionStorage and × on a marker removes an item', async () => {
    pick(badge())
    button('＋ Do dávky')!.click()
    await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(1))
    overlay.destroy()
    overlay = mountOverlay({ token: 'tok' })
    expect($('.batch')!.textContent).toContain('Dávka (1) · Odeslat')
    const marker = root().querySelector('.marker') as HTMLButtonElement
    expect(marker.textContent).toContain('1')
    marker.click()
    expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(0)
    expect($('.batch')).toBeNull()
  })
  it('a failed batch send shows a visible inline error, cleared by a successful retry', async () => {
    pick(badge())
    button('＋ Do dávky')!.click()
    await vi.waitFor(() => expect($('.batch')).toBeTruthy())
    expect($('.batch .err')?.hidden ?? true).toBe(true)
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }))
    button('Odeslat')!.click()
    await vi.waitFor(() => expect($('.batch .err')!.hidden).toBe(false))
    expect($('.batch .err')!.textContent).toBe('Nepodařilo se odeslat – běží proxy?')
    expect($('.batch .err')!.getAttribute('role')).toBe('alert')
    button('Odeslat')!.click()
    await vi.waitFor(() => expect($('.batch')).toBeNull())
  })
})

describe('progress pill', () => {
  const es = () => FakeEventSource.instances[0]
  it('connects to the SSE endpoint with the token', () => {
    expect(es().url).toBe('/__web-inspect/api/events?token=tok')
    expect($('.pill')).toBeNull()
  })
  it('running + tool label shows Claude: <label>…', () => {
    es().emitSnapshot({
      queue: [{ id: 'a', status: 'running', summary: 'Zvětši' }],
      progress: [{ kind: 'tool', label: 'upravuje Pricing.tsx', instructionId: 'a', at: 1 }],
    })
    expect($('.pill')!.textContent).toContain('Claude: upravuje Pricing.tsx…')
  })
  it('waiting-permission, queued, done', () => {
    es().emitSnapshot({
      queue: [{ id: 'a', status: 'running', summary: 'x' }],
      progress: [{ kind: 'waiting-permission', label: 'Čeká na schválení v terminálu', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Čeká na schválení v terminálu')
    es().emitSnapshot({ queue: [{ id: 'b', status: 'queued', summary: 'x' }, { id: 'c', status: 'queued', summary: 'y' }], progress: [] })
    expect($('.pill-line')!.textContent).toBe('Ve frontě: 2')
    es().emitSnapshot({ queue: [{ id: 'b', status: 'done', summary: 'x' }], progress: [] })
    expect($('.pill-line')!.textContent).toBe('Hotovo')
  })
  it('aborted → expanded pill has Poslat znovu which POSTs /api/resend', async () => {
    es().emitSnapshot({
      queue: [{ id: 'a', status: 'aborted', summary: 'Zvětši' }],
      progress: [{ kind: 'turn-aborted', label: 'Přerušeno', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Přerušeno')
    button('Přerušeno')!.click()
    expect($('.pill')!.textContent).toContain('Pokračuj zprávou v terminálu')
    button('Poslat znovu')!.click()
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/resend'))).toBe(true))
    expect(calls.find((c) => c.url.endsWith('/api/resend'))!.body).toEqual({ id: 'a' })
  })
  it('a non-2xx resend is swallowed', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 409 }))
    es().emitSnapshot({ queue: [{ id: 'a', status: 'aborted', summary: 'x' }], progress: [] })
    button('Přerušeno')!.click()
    button('Poslat znovu')!.click()
    await new Promise((r) => setTimeout(r, 20))
    expect($('.pill')).toBeTruthy()
  })
  it('picks the LATEST active entry, not an older orphan', () => {
    es().emitSnapshot({
      queue: [
        { id: 'old', status: 'sent', summary: 'x' },
        { id: 'new', status: 'running', summary: 'y' },
      ],
      progress: [
        { kind: 'tool', label: 'čte Old.tsx', instructionId: 'old', at: 1 },
        { kind: 'tool', label: 'upravuje New.tsx', instructionId: 'new', at: 2 },
      ],
    })
    expect($('.pill-line')!.textContent).toBe('Claude: upravuje New.tsx…')
  })
  it("a fresh instruction without tool events shows Claude: pracuje…, not the previous one's tool", () => {
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'done', summary: 'x' },
        { id: 'b', status: 'running', summary: 'y' },
      ],
      progress: [
        { kind: 'tool', label: 'upravuje Pricing.tsx', instructionId: 'a', at: 1 },
        { kind: 'turn-done', label: 'Hotovo', instructionId: 'a', at: 2 },
      ],
    })
    expect($('.pill-line')!.textContent).toBe('Claude: pracuje…')
  })
  it('after an abort, queued entries show the continue-in-terminal hint', () => {
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'aborted', summary: 'x' },
        { id: 'b', status: 'queued', summary: 'y' },
      ],
      progress: [{ kind: 'turn-aborted', label: 'Přerušeno', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Ve frontě – pokračuj zprávou v terminálu')
  })
  it('a held entry (mod paused) with queued entries shows the hint; resend only on aborted', () => {
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'held', summary: 'x' },
        { id: 'b', status: 'queued', summary: 'y' },
      ],
      progress: [{ kind: 'info', label: 'Přerušeno – pokračuj zprávou v terminálu', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Ve frontě – pokračuj zprávou v terminálu')
    $('.pill-head')!.click()
    expect(button('Poslat znovu')).toBeUndefined()
    expect($('.q .hint')!.textContent).toBe('Pokračuj zprávou v terminálu')
  })
  it('queued after a done turn, or after a proxy-side orphan abort, is plain Ve frontě: N', () => {
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'aborted', summary: 'x' },
        { id: 'b', status: 'done', summary: 'x' },
        { id: 'c', status: 'queued', summary: 'y' },
      ],
      progress: [
        { kind: 'turn-aborted', label: 'Přerušeno', instructionId: 'a', at: 1 },
        { kind: 'turn-done', label: 'Hotovo', instructionId: 'b', at: 2 },
      ],
    })
    expect($('.pill-line')!.textContent).toBe('Ve frontě: 1')
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'aborted', summary: 'x' },
        { id: 'c', status: 'queued', summary: 'y' },
      ],
      progress: [{ kind: 'info', label: 'Přerušeno – instrukce nedokončena', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Ve frontě: 1')
  })
  it('SSE error shows proxy neběží', () => {
    es().onerror?.(new Event('error'))
    expect($('.pill-line')!.textContent).toBe('web-inspect: proxy neběží')
    es().emitSnapshot({ queue: [{ id: 'b', status: 'done', summary: 'x' }], progress: [] })
    expect($('.pill-line')!.textContent).toBe('Hotovo')
  })
})

describe('react info', () => {
  const named = (name: string) => {
    const f = function () {}
    Object.defineProperty(f, 'name', { value: name })
    return f
  }
  const attach = (el: Element, fiber: unknown) => {
    ;(el as unknown as Record<string, unknown>)['__reactFiber$x'] = fiber
  }
  const stack = (url: string) => {
    const e = new Error('react-stack-top-frame')
    e.stack = `Error: react-stack-top-frame\n    at PlanCard (${url}:8:10)`
    return e
  }

  it('hover label shows component and already-known source', () => {
    attach(badge(), {
      type: 'span',
      return: { type: named('PlanCard'), return: null },
      _debugSource: { fileName: '/app/src/PlanCard.tsx', lineNumber: 8 },
    })
    altC()
    badge().dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }))
    expect($('.hover-label')!.textContent).toBe('span.badge · PlanCard (PlanCard.tsx:8)')
  })

  it('resolves a stack frame via /api/resolve-source and puts components + source into the item', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
      if (url.endsWith('/api/resolve-source')) return new Response(JSON.stringify({ file: 'src/PlanCard.tsx', line: 8 }))
      return new Response(JSON.stringify({ id: 'i1' }))
    })
    attach(badge(), { type: 'span', return: { type: named('PlanCard'), return: null }, _debugStack: stack('http://localhost:4000/src/PlanCard.tsx') })
    pick(badge())
    button('🗑 Smazat')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    expect(calls.find((c) => c.url.endsWith('/api/resolve-source'))!.body).toEqual({
      url: 'http://localhost:4000/src/PlanCard.tsx',
      line: 8,
      column: 10,
    })
    const el = instructionCalls()[0].body.items[0].element
    expect(el.components).toEqual(['PlanCard'])
    expect(el.source).toEqual({ file: 'src/PlanCard.tsx', line: 8 })
  })

  it('omits source when resolve-source fails', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
      if (url.endsWith('/api/resolve-source')) throw new TypeError('network')
      return new Response(JSON.stringify({ id: 'i1' }))
    })
    attach(badge(), { type: 'span', return: { type: named('PlanCard'), return: null }, _debugStack: stack('http://localhost:4000/src/PlanCard.tsx') })
    pick(badge())
    button('🗑 Smazat')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    expect(instructionCalls()[0].body.items[0].element).not.toHaveProperty('source')
  })

  it('Next.js Server Component: refines the approximate source via resolve-source, falls back to it on failure', async () => {
    const rscFrame = 'about://React/Server/webpack-internal:///(rsc)/./components/PlanCard.tsx?13'
    let resolved: unknown = { file: 'components/PlanCard.tsx', line: 6, column: 17 }
    fetchMock.mockImplementation(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
      if (url.endsWith('/api/resolve-source')) return new Response(JSON.stringify(resolved))
      return new Response(JSON.stringify({ id: 'i1' }))
    })
    const e = new Error('react-stack-top-frame')
    e.stack = `Error: react-stack-top-frame\n    at fakeJSXCallSite (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react-server-dom-webpack/x.js:1:1)\n    at PlanCard (${rscFrame}:12:97)`
    const planCard = { name: 'PlanCard', env: 'Server', stack: [] }
    attach(badge(), { type: 'span', _debugStack: e, return: { type: 'div', _debugInfo: [planCard], return: { type: named('SegmentViewNode'), return: null } } })
    altC()
    badge().dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }))
    expect($('.hover-label')!.textContent).toBe('span.badge · PlanCard (PlanCard.tsx)')
    click(badge())
    button('🗑 Smazat')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    expect(calls.find((c) => c.url.endsWith('/api/resolve-source'))!.body).toEqual({ url: rscFrame, line: 12, column: 97 })
    expect(instructionCalls()[0].body.items[0].element.components).toEqual(['PlanCard'])
    expect(instructionCalls()[0].body.items[0].element.source).toEqual({ file: 'components/PlanCard.tsx', line: 6, column: 17 })

    resolved = null // proxy could not map it → keep the approximate source
    click(badge()) // picking is still on
    button('🗑 Smazat')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(2))
    expect(instructionCalls()[1].body.items[0].element.source).toEqual({ file: 'components/PlanCard.tsx', line: 12, column: 97 })
  })

  it('a failed send keeps the bubble open with an error', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
    pick(badge())
    button('🗑 Smazat')!.click()
    await vi.waitFor(() => expect($('.bubble .err')!.hidden).toBe(false))
    expect($('.bubble')).toBeTruthy()
  })
})
