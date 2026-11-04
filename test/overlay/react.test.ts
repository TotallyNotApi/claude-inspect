// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseStackFrames, reactInfo } from '../../src/overlay/react.ts'

type Fiber = {
  type: unknown
  return: Fiber | null
  _debugInfo?: unknown[]
  _debugSource?: { fileName: string; lineNumber: number; columnNumber?: number }
  _debugStack?: Error
}

const fiber = (type: unknown, parent: Fiber | null, extra: Partial<Fiber> = {}): Fiber => ({ type, return: parent, ...extra })
const named = (name: string) => {
  const f = function () {}
  Object.defineProperty(f, 'name', { value: name })
  return f
}
const attach = (el: Element, f: Fiber) => {
  ;(el as unknown as Record<string, unknown>)['__reactFiber$abc123'] = f
}
const stackError = (stack: string) => {
  const e = new Error('react-stack-top-frame')
  e.stack = stack
  return e
}

describe('reactInfo', () => {
  it('collects component names nearest-first and uses _debugSource (React <= 18)', () => {
    const page = fiber(named('Page'), null)
    const pricing = fiber(named('Pricing'), page)
    const card = fiber(named('PlanCard'), pricing)
    const host = fiber('span', card, {
      _debugSource: { fileName: '/home/me/app/src/components/PlanCard.tsx', lineNumber: 8, columnNumber: 10 },
    })
    const el = document.createElement('span')
    attach(el, host)
    const info = reactInfo(el)
    expect(info.components).toEqual(['PlanCard', 'Pricing', 'Page'])
    expect(info.source).toEqual({ file: '/home/me/app/src/components/PlanCard.tsx', line: 8, column: 10 })
    expect(info.stackFrame).toBeUndefined()
  })

  it('uses _debugStack (React 19), skipping framework frames', () => {
    const card = fiber(named('PlanCard'), null)
    const host = fiber('span', card, {
      _debugStack: stackError(
        [
          'Error: react-stack-top-frame',
          '    at exports.jsxDEV (http://localhost:4000/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:30)',
          '    at renderWithHooks (http://localhost:4000/node_modules/.vite/deps/react-dom_client.js?v=1:11548:26)',
          '    at PlanCard (http://localhost:4000/src/components/PlanCard.tsx?t=1:8:10)',
          '    at Pricing (http://localhost:4000/src/Pricing.tsx:3:3)',
        ].join('\n'),
      ),
    })
    const el = document.createElement('span')
    attach(el, host)
    const info = reactInfo(el)
    expect(info.components).toEqual(['PlanCard'])
    expect(info.source).toBeUndefined()
    expect(info.stackFrame).toEqual({ url: 'http://localhost:4000/src/components/PlanCard.tsx?t=1', line: 8, column: 10 })
  })

  it('does not skip Next.js app chunks, but skips Next framework chunks', () => {
    const card = fiber(named('PlanCard'), null)
    const host = fiber('div', card, {
      _debugStack: stackError(
        [
          'Error: react-stack-top-frame',
          '    at http://localhost:4000/_next/static/chunks/webpack.js:10:1',
          '    at jsxDEV (http://localhost:4000/_next/static/chunks/main-app.js:99:9)',
          '    at PlanCard (http://localhost:4000/_next/static/chunks/app/page.js:123:45)',
        ].join('\n'),
      ),
    })
    const el = document.createElement('div')
    attach(el, host)
    expect(reactInfo(el).stackFrame).toEqual({ url: 'http://localhost:4000/_next/static/chunks/app/page.js', line: 123, column: 45 })
  })

  it('Next webpack dev: webpack-internal frame becomes approximate source plus a stackFrame to refine', () => {
    const card = fiber(named('PlanCard'), null)
    const host = fiber('div', card, {
      _debugStack: stackError(
        [
          'Error: react-stack-top-frame',
          '    at jsxDEV (webpack-internal:///(app-pages-browser)/./node_modules/next/dist/compiled/react/cjs/react-jsx-dev-runtime.development.js:346:13)',
          '    at PlanCard (webpack-internal:///(app-pages-browser)/./src/components/PlanCard.tsx:10:5)',
        ].join('\n'),
      ),
    })
    const el = document.createElement('div')
    attach(el, host)
    expect(reactInfo(el)).toEqual({
      components: ['PlanCard'],
      source: { file: 'src/components/PlanCard.tsx', line: 10, column: 5 },
      stackFrame: { url: 'webpack-internal:///(app-pages-browser)/./src/components/PlanCard.tsx', line: 10, column: 5 },
    })
  })

  it('dedupes consecutive identical names (memo double fibers)', () => {
    const page = fiber(named('Page'), null)
    const memo = fiber({ $$typeof: Symbol.for('react.memo'), type: named('Card') }, page)
    const inner = fiber(named('Card'), memo)
    const el = document.createElement('div')
    attach(el, fiber('div', inner))
    expect(reactInfo(el).components).toEqual(['Card', 'Page'])
  })

  it('filters Next.js internals, lowercase names, Providers/Contexts; handles forwardRef/memo/displayName; max 5', () => {
    let f: Fiber | null = null
    const chain: unknown[] = [
      named('ServerRoot'),
      named('AppRouter'),
      named('Layout'),
      named('ThemeProvider'),
      named('InnerLayoutRouter'),
      named('Page'),
      named('Section'),
      Object.assign(named('X'), { displayName: 'Shown' }),
      { $$typeof: Symbol.for('react.memo'), type: named('MemoCard') },
      { $$typeof: Symbol.for('react.forward_ref'), render: named('FancyButton') },
      named('SomeContext'),
      named('useless'),
      'button',
    ]
    for (const t of chain) f = fiber(t, f)
    const el = document.createElement('button')
    attach(el, f!)
    expect(reactInfo(el).components).toEqual(['FancyButton', 'MemoCard', 'Shown', 'Section', 'Page'])
  })

  it('finds the fiber on the nearest ancestor', () => {
    const outer = document.createElement('div')
    const inner = document.createElement('b')
    outer.appendChild(inner)
    attach(outer, fiber('div', fiber(named('Card'), null)))
    expect(reactInfo(inner).components).toEqual(['Card'])
  })

  it('element without fiber → { components: [] }', () => {
    expect(reactInfo(document.createElement('div'))).toEqual({ components: [] })
  })

  it('never throws on hostile fibers', () => {
    const el = document.createElement('div')
    const evil = {} as Record<string, unknown>
    Object.defineProperty(evil, 'type', { get: () => { throw new Error('boom') } })
    attach(el, evil as unknown as Fiber)
    expect(reactInfo(el)).toEqual({ components: [] })
  })
})

describe('parseStackFrames', () => {
  it('parses V8 named, anonymous and webpack-internal frames, and Firefox frames', () => {
    const frames = parseStackFrames(
      [
        'Error: x',
        '    at Foo (webpack-internal:///(app-pages-browser)/./src/x.tsx:10:5)',
        '    at webpack-internal:///(app-pages-browser)/./src/y.tsx:11:6',
        '    at async Object.<anonymous> (http://h/a.js:1:2)',
        '    at <anonymous>',
        'Bar@http://h/b.js:3:4',
      ].join('\n'),
    )
    expect(frames).toEqual([
      { url: 'webpack-internal:///(app-pages-browser)/./src/x.tsx', line: 10, column: 5 },
      { url: 'webpack-internal:///(app-pages-browser)/./src/y.tsx', line: 11, column: 6 },
      { url: 'http://h/a.js', line: 1, column: 2 },
      { url: 'http://h/b.js', line: 3, column: 4 },
    ])
  })
})

// Shapes observed on Next.js 15.5 (webpack dev) + React 19 for <span class="badge"> rendered by the
// Server Component PlanCard (components/PlanCard.tsx) inside Pricing inside app/page.tsx.
describe('reactInfo on Next.js App Router (Server Components)', () => {
  const NM = 'webpack-internal:///(app-pages-browser)/./node_modules'
  const FLIGHT = `${NM}/next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.browser.development.js`
  const serverStack = (fn: string, url: string, line: number, col: number) =>
    stackError(
      [
        'Error: react-stack-top-frame',
        `    at fakeJSXCallSite (${FLIGHT}:2623:14)`,
        `    at ${fn} (about://React/Server/${url}:${line}:${col})`,
        `    at Object.react_stack_bottom_frame (${FLIGHT}:3448:12)`,
        `    at initializeElement (${FLIGHT}:1367:35)`,
      ].join('\n'),
    )
  const nextStack = () =>
    stackError(
      [
        'Error: react-stack-top-frame',
        `    at exports.jsx (${NM}/next/dist/compiled/react/cjs/react-jsx-runtime.development.js:321:13)`,
        `    at LayoutRouter (${NM}/next/dist/client/components/layout-router.js:500:20)`,
      ].join('\n'),
    )
  // ReactComponentInfo as found in fiber._debugInfo (and as fiber._debugOwner).
  const info = (name: string, owner: unknown = null) => ({
    name,
    env: 'Server',
    key: null,
    owner,
    stack: [[name, `webpack-internal:///(rsc)/./components/${name}.tsx`, 32, 96, 10, 1, false]],
    props: {},
    debugTask: {},
    debugStack: new Error('react-stack-top-frame'),
  })

  function nextTree() {
    const rootLayout = info('RootLayout')
    const page = info('Page')
    const pricing = info('Pricing', page)
    const planCard = info('PlanCard', pricing)
    let f: Fiber | null = null
    const push = (type: unknown, extra: Partial<Fiber> = {}) => (f = fiber(type, f, extra))
    push(named('ServerRoot'), { _debugStack: nextStack() })
    push(named('AppRouter'), { _debugStack: nextStack() })
    push(named('Router'), { _debugStack: nextStack() })
    push(named('HotReload'), { _debugStack: nextStack() })
    push(named('AppDevOverlayErrorBoundary'))
    push(named('DevRootHTTPAccessFallbackBoundary'))
    push(named('HTTPAccessFallbackBoundary'))
    push(named('RedirectBoundary'))
    push(named('__next_root_layout_boundary__'))
    push(named('SegmentViewNode'))
    push('html', { _debugInfo: [rootLayout] })
    push('body')
    push(named('OuterLayoutRouter'))
    push(named('SegmentStateProvider'))
    push({ $$typeof: Symbol.for('react.context'), displayName: 'TemplateContext' })
    push(named('RenderFromTemplateContext'))
    push(named('ScrollAndFocusHandler'))
    push(named('InnerScrollAndFocusHandler'))
    push(named('ErrorBoundary'), { _debugStack: nextStack() })
    push(named('LoadingBoundary'), { _debugStack: nextStack() })
    push(named('HTTPAccessFallbackBoundary'))
    push(named('HTTPAccessFallbackErrorBoundary'))
    push(named('RedirectBoundary'))
    push(named('RedirectErrorBoundary'))
    push(named('InnerLayoutRouter'))
    push({ $$typeof: Symbol.for('react.context'), displayName: 'LayoutRouterContext' })
    push(named('SegmentViewNode'), { _debugStack: stackError('Error: react-stack-top-frame\n    at Promise.all (<anonymous>:1:20)') })
    push(null, { _debugInfo: [page] })
    push('main', { _debugInfo: [page] })
    push('section', { _debugInfo: [pricing], _debugStack: serverStack('Pricing', 'webpack-internal:///(rsc)/./components/Pricing.tsx?2', 32, 96) })
    push('div')
    push('div', { _debugInfo: [planCard] })
    const span = push('span', {
      _debugStack: serverStack('PlanCard', 'webpack-internal:///(rsc)/./components/PlanCard.tsx?13', 12, 97),
    })
    return span
  }

  it('uses Server Component names from _debugInfo and drops every Next internal', () => {
    const el = document.createElement('span')
    attach(el, nextTree())
    expect(reactInfo(el).components).toEqual(['PlanCard', 'Pricing', 'Page', 'RootLayout'])
  })

  it('derives an approximate source from the about://React/Server frame and keeps it as stackFrame', () => {
    const el = document.createElement('span')
    attach(el, nextTree())
    const r = reactInfo(el)
    expect(r.source).toEqual({ file: 'components/PlanCard.tsx', line: 12, column: 97 })
    expect(r.stackFrame).toEqual({
      url: 'about://React/Server/webpack-internal:///(rsc)/./components/PlanCard.tsx?13',
      line: 12,
      column: 97,
    })
  })

  it('handles rsc://React/Server/file:// frames (absolute path source)', () => {
    const el = document.createElement('b')
    attach(
      el,
      fiber('b', fiber('div', null, { _debugInfo: [info('Card')] }), {
        _debugStack: stackError(
          'Error: react-stack-top-frame\n' +
            `    at fakeJSXCallSite (${FLIGHT}:2623:14)\n` +
            '    at Card (rsc://React/Server/file:///home/me/app/src/Card.tsx?3:7:5)',
        ),
      }),
    )
    const r = reactInfo(el)
    expect(r.components).toEqual(['Card'])
    expect(r.source).toEqual({ file: '/home/me/app/src/Card.tsx', line: 7, column: 5 })
    expect(r.stackFrame).toEqual({ url: 'rsc://React/Server/file:///home/me/app/src/Card.tsx?3', line: 7, column: 5 })
  })

  it('a client component rendered by a Server Component lists itself, then the server owners', () => {
    const page = info('Page')
    const client = fiber(named('Counter'), fiber('main', null, { _debugInfo: [page] }), { _debugInfo: [info('Pricing', page)] })
    const el = document.createElement('button')
    attach(el, fiber('button', client))
    expect(reactInfo(el).components).toEqual(['Counter', 'Pricing', 'Page'])
  })

  it('ignores non-component _debugInfo entries (timing, awaited I/O) and lists outer-first entries closest-first', () => {
    const el = document.createElement('i')
    attach(el, fiber('i', null, { _debugInfo: [{ time: 12 }, info('Outer'), { awaited: { name: 'fetch' } }, info('Inner'), { time: 13 }] }))
    expect(reactInfo(el).components).toEqual(['Inner', 'Outer'])
  })

  it('keeps a user component named like a Next internal when its element was created in user code', () => {
    const userStack = stackError(
      'Error: react-stack-top-frame\n' +
        `    at exports.jsx (${NM}/next/dist/compiled/react/cjs/react-jsx-runtime.development.js:321:13)\n` +
        '    at Page (webpack-internal:///(app-pages-browser)/./app/page.tsx:9:5)',
    )
    const nextEb = fiber(named('ErrorBoundary'), null, { _debugStack: nextStack() })
    const noInfoEb = fiber(named('ErrorBoundary'), nextEb)
    const userEb = fiber(named('ErrorBoundary'), noInfoEb, { _debugStack: userStack })
    const el = document.createElement('p')
    attach(el, fiber('p', userEb))
    expect(reactInfo(el).components).toEqual(['ErrorBoundary'])
    // React <= 18: _debugSource outside node_modules also counts as user code.
    const userEb18 = fiber(named('ErrorBoundary'), null, { _debugSource: { fileName: '/home/me/app/src/ErrorBoundary.tsx', lineNumber: 3 } })
    const el2 = document.createElement('p')
    attach(el2, fiber('p', userEb18))
    expect(reactInfo(el2).components).toEqual(['ErrorBoundary'])
  })

  it("drops Next's wrappers around a 'use client' page/layout (ClientPageRoot, ClientSegmentRoot, metadata outlets)", () => {
    let f: Fiber | null = null
    const push = (type: unknown, extra: Partial<Fiber> = {}) => (f = fiber(type, f, extra))
    push(named('ClientSegmentRoot'), { _debugStack: nextStack() })
    push(named('Layout'))
    push(named('MetadataOutlet'))
    push(named('AsyncMetadataOutlet'))
    push(named('ClientPageRoot'), { _debugStack: nextStack() })
    push(named('Page'))
    push(named('Counter'))
    const el = document.createElement('button')
    attach(el, push('button'))
    expect(reactInfo(el).components).toEqual(['Counter', 'Page', 'Layout'])
  })
})
