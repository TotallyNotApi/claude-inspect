// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseStackFrames, reactInfo } from '../../src/overlay/react.ts'

type Fiber = {
  type: unknown
  return: Fiber | null
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

  it('Next webpack dev: webpack-internal frame becomes source directly, no stackFrame', () => {
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
