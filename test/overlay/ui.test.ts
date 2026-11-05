// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isMacPlatform, mountOverlay } from '../../src/overlay/index.ts'
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
  Array.from(root().querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === text || b.textContent!.includes(text),
  ) as HTMLButtonElement | undefined
const toggleOn = () => $('.toggle[aria-pressed="true"]') as HTMLButtonElement | null
const toggleOff = () => $('.toggle[aria-pressed="false"]') as HTMLButtonElement | null
const batchSend = () => $('.batch .send') as HTMLButtonElement
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
    expect(toggleOff()!.textContent).toBe('InspectAlt+C')
    expect($('.toggle .icon svg')).toBeTruthy()
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
    expect(toggleOn()!.textContent).toBe('InspectingAlt+C')
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
    for (const t of ['Edit', 'Delete', 'Improve', 'Add to batch', 'Send']) {
      expect(button(t), t).toBeTruthy()
      expect(button(t)!.dataset.tip, t).toBeTruthy()
    }
    expect(bubble.querySelector('.el-name')!.textContent).toBe('span.badge')
    const field = bubble.querySelector('textarea')!
    expect(field.getAttribute('placeholder')).toBe('Describe the change…')
    expect(field.getAttribute('rows')).toBe('3')
    expect(button('Send')!.disabled).toBe(true)
  })
  it('clicking an overlay element does not select it', () => {
    altC()
    click(toggleOn()!)
    expect($('.bubble')).toBeNull()
    // and the toggle still works as a button: it turned picking off
    expect(toggleOff()).toBeTruthy()
  })
  it('Esc closes the bubble, the second Esc turns picking off', () => {
    pick(badge())
    esc()
    expect($('.bubble')).toBeNull()
    expect(toggleOn()).toBeTruthy()
    esc()
    expect(toggleOff()).toBeTruthy()
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
      expect(toggleOff(), t.tagName).toBeTruthy()
    }
  })
  it("Alt+C in the bubble's own textarea does not toggle picking", () => {
    pick(badge())
    const field = $('.bubble textarea')!
    key('KeyC', { altKey: true, key: 'ç' }, field)
    expect(toggleOn()).toBeTruthy()
    expect($('.bubble')).toBeTruthy()
  })
  it('a repeated Alt+C keydown (key held) is ignored', () => {
    key('KeyC', { altKey: true, key: 'ç', repeat: true })
    expect(toggleOff()).toBeTruthy()
  })
  it('Esc during IME composition does nothing', () => {
    pick(badge())
    key('Escape', { key: 'Escape', isComposing: true })
    expect($('.bubble')).toBeTruthy()
  })
})

describe('bubble actions', () => {
  it('Delete sends the delete instruction with element context', async () => {
    pick(badge())
    button('Delete')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    const c = instructionCalls()[0]
    expect(c.url).toBe('/__web-inspect/api/instructions')
    expect(c.headers['x-web-inspect-token']).toBe('tok')
    expect(c.headers['content-type']).toBe('application/json')
    expect(c.body.pageUrl).toBe(location.href)
    expect(c.body.items).toHaveLength(1)
    expect(c.body.items[0].instruction).toBe('Delete this element.')
    expect(c.body.items[0].element.domPath).toBe('main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge')
    expect(c.body.items[0].element.components).toEqual([])
    await vi.waitFor(() => expect($('.bubble')).toBeNull())
    expect(toggleOn()).toBeTruthy()
  })
  it('Edit prefills "Change this: " and focuses the field', () => {
    pick(badge())
    button('Edit')!.click()
    const field = $('.bubble textarea') as HTMLTextAreaElement
    expect(field.value).toBe('Change this: ')
    expect(root().activeElement).toBe(field)
  })
  it('Improve prefills the improve text', () => {
    pick(badge())
    button('Improve')!.click()
    expect(($('.bubble textarea') as HTMLTextAreaElement).value).toBe(
      'Improve this element (visuals, copy, accessibility) in the style of the rest of the page.',
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
  it('two Add to batch → storage has 2 items, pill shows Batch (2) · Send, sending posts once', async () => {
    pick(badge())
    ;($('.bubble textarea') as HTMLTextAreaElement).value = 'Zvětši'
    button('Add to batch')!.click()
    await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(1))
    click(document.querySelector('h2')!)
    button('Add to batch')!.click()
    await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(2))
    const stored = JSON.parse(sessionStorage.getItem('web-inspect:batch')!)
    expect(stored[0].instruction).toBe('Zvětši')
    expect(stored[1].instruction).toBe('Adjust as needed.')
    expect($('.batch')!.textContent).toContain('Batch (2) · Send')
    expect(root().querySelectorAll('.marker')).toHaveLength(2)
    expect(instructionCalls()).toHaveLength(0)

    batchSend().click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    expect(instructionCalls()[0].body.items).toHaveLength(2)
    await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(0))
    expect($('.batch')).toBeNull()
    expect(root().querySelectorAll('.marker')).toHaveLength(0)
  })
  it('restores the batch from sessionStorage and × on a marker removes an item', async () => {
    pick(badge())
    button('Add to batch')!.click()
    await vi.waitFor(() => expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(1))
    overlay.destroy()
    overlay = mountOverlay({ token: 'tok' })
    expect($('.batch')!.textContent).toContain('Batch (1) · Send')
    const marker = root().querySelector('.marker') as HTMLButtonElement
    expect(marker.textContent).toContain('1')
    marker.click()
    expect(JSON.parse(sessionStorage.getItem('web-inspect:batch') ?? '[]')).toHaveLength(0)
    expect($('.batch')).toBeNull()
  })
  it('a failed batch send shows a visible inline error, cleared by a successful retry', async () => {
    pick(badge())
    button('Add to batch')!.click()
    await vi.waitFor(() => expect($('.batch')).toBeTruthy())
    expect($('.batch .err')?.hidden ?? true).toBe(true)
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }))
    batchSend().click()
    await vi.waitFor(() => expect($('.batch .err')!.hidden).toBe(false))
    expect($('.batch .err')!.textContent).toBe('Couldn’t send. Is the proxy running?')
    expect($('.batch .err')!.getAttribute('role')).toBe('alert')
    batchSend().click()
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
      progress: [{ kind: 'tool', label: 'editing Pricing.tsx', instructionId: 'a', at: 1 }],
    })
    expect($('.pill')!.textContent).toContain('Claude: editing Pricing.tsx…')
  })
  it('waiting-permission, queued, done', () => {
    es().emitSnapshot({
      queue: [{ id: 'a', status: 'running', summary: 'x' }],
      progress: [{ kind: 'waiting-permission', label: 'Waiting for approval in the terminal', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Waiting for approval in the terminal')
    es().emitSnapshot({ queue: [{ id: 'b', status: 'queued', summary: 'x' }, { id: 'c', status: 'queued', summary: 'y' }], progress: [] })
    expect($('.pill-line')!.textContent).toBe('Queued: 2')
    es().emitSnapshot({ queue: [{ id: 'b', status: 'done', summary: 'x' }], progress: [] })
    expect($('.pill-line')!.textContent).toBe('Done')
  })
  it('aborted → expanded pill has Send again which POSTs /api/resend', async () => {
    es().emitSnapshot({
      queue: [{ id: 'a', status: 'aborted', summary: 'Zvětši' }],
      progress: [{ kind: 'turn-aborted', label: 'Interrupted', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Interrupted')
    button('Interrupted')!.click()
    expect($('.pill')!.textContent).toContain('Send a message in the terminal to continue')
    button('Send again')!.click()
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/resend'))).toBe(true))
    expect(calls.find((c) => c.url.endsWith('/api/resend'))!.body).toEqual({ id: 'a' })
  })
  it('a non-2xx resend is swallowed', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 409 }))
    es().emitSnapshot({ queue: [{ id: 'a', status: 'aborted', summary: 'x' }], progress: [] })
    button('Interrupted')!.click()
    button('Send again')!.click()
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
        { kind: 'tool', label: 'reading Old.tsx', instructionId: 'old', at: 1 },
        { kind: 'tool', label: 'editing New.tsx', instructionId: 'new', at: 2 },
      ],
    })
    expect($('.pill-line')!.textContent).toBe('Claude: editing New.tsx…')
  })
  it("a fresh instruction without tool events shows Claude: working…, not the previous one's tool", () => {
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'done', summary: 'x' },
        { id: 'b', status: 'running', summary: 'y' },
      ],
      progress: [
        { kind: 'tool', label: 'editing Pricing.tsx', instructionId: 'a', at: 1 },
        { kind: 'turn-done', label: 'Done', instructionId: 'a', at: 2 },
      ],
    })
    expect($('.pill-line')!.textContent).toBe('Claude: working…')
  })
  it('after an abort, queued entries show the continue-in-terminal hint', () => {
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'aborted', summary: 'x' },
        { id: 'b', status: 'queued', summary: 'y' },
      ],
      progress: [{ kind: 'turn-aborted', label: 'Interrupted', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Queued. Send a message in the terminal to continue')
  })
  it('a held entry (mod paused) with queued entries shows the hint; resend only on aborted', () => {
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'held', summary: 'x' },
        { id: 'b', status: 'queued', summary: 'y' },
      ],
      progress: [{ kind: 'info', label: 'Interrupted. Send a message in the terminal to continue', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Queued. Send a message in the terminal to continue')
    $('.pill-head')!.click()
    expect(button('Send again')).toBeUndefined()
    expect($('.q .hint')!.textContent).toBe('Send a message in the terminal to continue')
  })
  it('queued after a done turn, or after a proxy-side orphan abort, is plain Queued: N', () => {
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'aborted', summary: 'x' },
        { id: 'b', status: 'done', summary: 'x' },
        { id: 'c', status: 'queued', summary: 'y' },
      ],
      progress: [
        { kind: 'turn-aborted', label: 'Interrupted', instructionId: 'a', at: 1 },
        { kind: 'turn-done', label: 'Done', instructionId: 'b', at: 2 },
      ],
    })
    expect($('.pill-line')!.textContent).toBe('Queued: 1')
    es().emitSnapshot({
      queue: [
        { id: 'a', status: 'aborted', summary: 'x' },
        { id: 'c', status: 'queued', summary: 'y' },
      ],
      progress: [{ kind: 'info', label: 'Interrupted. The instruction didn’t finish', instructionId: 'a', at: 1 }],
    })
    expect($('.pill-line')!.textContent).toBe('Queued: 1')
  })
  it('SSE error shows proxy isn’t running', () => {
    es().onerror?.(new Event('error'))
    expect($('.pill-line')!.textContent).toBe('web-inspect: proxy isn’t running')
    es().emitSnapshot({ queue: [{ id: 'b', status: 'done', summary: 'x' }], progress: [] })
    expect($('.pill-line')!.textContent).toBe('Done')
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
    button('Delete')!.click()
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
    button('Delete')!.click()
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
    button('Delete')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    expect(calls.find((c) => c.url.endsWith('/api/resolve-source'))!.body).toEqual({ url: rscFrame, line: 12, column: 97 })
    expect(instructionCalls()[0].body.items[0].element.components).toEqual(['PlanCard'])
    expect(instructionCalls()[0].body.items[0].element.source).toEqual({ file: 'components/PlanCard.tsx', line: 6, column: 17 })

    resolved = null // proxy could not map it → keep the approximate source
    click(badge()) // picking is still on
    button('Delete')!.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(2))
    expect(instructionCalls()[1].body.items[0].element.source).toEqual({ file: 'components/PlanCard.tsx', line: 12, column: 97 })
  })

  it('a failed send keeps the bubble open with an error', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 500 }))
    pick(badge())
    button('Delete')!.click()
    await vi.waitFor(() => expect($('.bubble .err')!.hidden).toBe(false))
    expect($('.bubble')).toBeTruthy()
  })
})

describe('macOS shortcut', () => {
  const cmdC = (target: EventTarget = window) => key('KeyC', { metaKey: true, key: 'c' }, target)
  beforeEach(() => {
    overlay.destroy()
    overlay = mountOverlay({ token: 'tok', mac: true })
  })
  it('shows ⌘C and ⌘C toggles picking', () => {
    expect(toggleOff()!.textContent).toBe('Inspect⌘C')
    expect(toggleOff()!.title).toContain('⌘C')
    cmdC()
    expect(toggleOn()!.textContent).toBe('Inspecting⌘C')
    cmdC()
    expect(toggleOff()).toBeTruthy()
  })
  it('⌥C still works as a fallback', () => {
    key('KeyC', { altKey: true, key: 'ç' })
    expect(toggleOn()).toBeTruthy()
  })
  it('⌘C with selected page text is left to copy', () => {
    const range = document.createRange()
    range.selectNodeContents(badge())
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    cmdC()
    expect(toggleOff()).toBeTruthy()
    window.getSelection()!.removeAllRanges()
  })
  it('⌘C inside a page field or the bubble is left to copy', () => {
    const input = document.createElement('input')
    document.body.append(input)
    cmdC(input)
    expect(toggleOff()).toBeTruthy()
    pick(badge())
    cmdC($('.bubble textarea')!)
    expect(toggleOn()).toBeTruthy()
    expect($('.bubble')).toBeTruthy()
  })
  it('⌘⇧C and ⌃C are ignored', () => {
    key('KeyC', { metaKey: true, shiftKey: true, key: 'c' })
    key('KeyC', { ctrlKey: true, key: 'c' })
    expect(toggleOff()).toBeTruthy()
  })
})

describe('non-mac shortcut', () => {
  it('⌘C/Win+C does not toggle; Alt+C does', () => {
    key('KeyC', { metaKey: true, key: 'c' })
    expect(toggleOff()).toBeTruthy()
    altC()
    expect(toggleOn()).toBeTruthy()
  })
  it('isMacPlatform reads userAgentData, platform or userAgent', () => {
    expect(isMacPlatform({ userAgentData: { platform: 'macOS' } } as any)).toBe(true)
    expect(isMacPlatform({ platform: 'MacIntel' } as any)).toBe(true)
    expect(isMacPlatform({ platform: '', userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0)' } as any)).toBe(true)
    expect(isMacPlatform({ platform: 'Win32', userAgent: 'Windows' } as any)).toBe(false)
    expect(isMacPlatform({ platform: 'Linux x86_64', userAgent: 'X11' } as any)).toBe(false)
  })
})

describe('bubble polish', () => {
  it('Send is enabled only with text and sends it', async () => {
    pick(badge())
    const field = $('.bubble textarea') as HTMLTextAreaElement
    const send = button('Send')!
    expect(send.disabled).toBe(true)
    field.value = 'Make it green'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    expect(send.disabled).toBe(false)
    send.click()
    await vi.waitFor(() => expect(instructionCalls()).toHaveLength(1))
    expect(instructionCalls()[0].body.items[0].instruction).toBe('Make it green')
  })
  it('the close button closes the bubble but keeps picking on', () => {
    pick(badge())
    button('Close (Esc)')!.click()
    expect($('.bubble')).toBeNull()
    expect(toggleOn()).toBeTruthy()
  })
  it('a failed send shows the English error inside the bubble', async () => {
    fetchMock.mockImplementationOnce(async () => new Response('{}', { status: 500 }))
    pick(badge())
    button('Delete')!.click()
    await vi.waitFor(() => expect($('.bubble .err')!.hidden).toBe(false))
    expect($('.bubble .err')!.textContent).toBe('Couldn’t send. Is the proxy running?')
  })
})
