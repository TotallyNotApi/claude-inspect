// React fiber introspection: component names and source location for a DOM element.
// Works on dev builds only (fibers carry _debugSource / _debugStack there). Never throws.
import type { SourceLoc } from '../../plugin/hooks/lib/types.ts'

export type StackFrame = { url: string; line: number; column: number }
export type ReactInfo = { components: string[]; source?: SourceLoc; stackFrame?: StackFrame }

type Fiber = {
  type?: unknown
  return?: Fiber | null
  _debugSource?: { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown } | null
  _debugStack?: { stack?: unknown } | null
}

const MAX_COMPONENTS = 5
const MAX_DEPTH = 500
const NEXT_INTERNALS =
  /^(InnerLayoutRouter|OuterLayoutRouter|RedirectBoundary|NotFoundBoundary|ErrorBoundary|LoadingBoundary|ScrollAndFocusHandler|RenderFromTemplateContext|HotReload|Router|AppRouter|ServerRoot)$/
// Framework frames to skip in a React 19 _debugStack (Controller Ruling R11: the brief's blanket
// `/_next/static/chunks/` would also drop Next app chunks such as `/_next/static/chunks/app/page.js`).
const FRAMEWORK_FRAME = [
  'node_modules',
  'react-dom',
  'react.development',
  'react-server-dom',
  'next/dist',
  '/_next/static/chunks/webpack',
  '/_next/static/chunks/framework',
  '/_next/static/chunks/main',
  '/_next/static/chunks/polyfills',
]

function findFiber(el: Element): Fiber | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const key = Object.keys(n).find((k) => k.startsWith('__reactFiber$'))
    if (key) return (n as unknown as Record<string, Fiber>)[key] ?? null
  }
  return null
}

// Display name of a component type (function/class, forwardRef, memo); null for host/other fibers.
function typeName(type: unknown, depth = 0): string | null {
  if (depth > 3 || !type) return null
  if (typeof type === 'function') {
    const t = type as { displayName?: unknown; name?: unknown }
    const n = typeof t.displayName === 'string' && t.displayName ? t.displayName : t.name
    return typeof n === 'string' && n ? n : null
  }
  if (typeof type === 'object') {
    const t = type as { displayName?: unknown; render?: unknown; type?: unknown }
    if (typeof t.render !== 'function' && !t.type) return null
    if (typeof t.displayName === 'string' && t.displayName) return t.displayName
    return typeName(typeof t.render === 'function' ? t.render : t.type, depth + 1)
  }
  return null
}

function isUserComponent(name: string): boolean {
  return /^[A-Z]/.test(name) && !NEXT_INTERNALS.test(name) && !/(Provider|Context)$/.test(name)
}

// Parses V8 (`    at Name (url:l:c)`, `    at url:l:c`) and Firefox/Safari (`name@url:l:c`) frames.
export function parseStackFrames(stack: string): StackFrame[] {
  const out: StackFrame[] = []
  for (const raw of stack.split('\n')) {
    const line = raw.trim()
    let loc: string
    if (line.startsWith('at ')) {
      const rest = line.slice(3)
      const paren = rest.lastIndexOf(' (')
      loc = rest.endsWith(')') && paren >= 0 ? rest.slice(paren + 2, -1) : rest
    } else if (line.includes('@')) {
      loc = line.slice(line.indexOf('@') + 1)
    } else continue
    const m = /^(.+):(\d+):(\d+)$/.exec(loc)
    if (!m || /\s/.test(m[1])) continue
    out.push({ url: m[1], line: Number(m[2]), column: Number(m[3]) })
  }
  return out
}

function sourceOf(f: Fiber): Pick<ReactInfo, 'source' | 'stackFrame'> | null {
  const ds = f._debugSource
  if (ds && typeof ds.fileName === 'string' && typeof ds.lineNumber === 'number') {
    const source: SourceLoc = { file: ds.fileName, line: ds.lineNumber }
    if (typeof ds.columnNumber === 'number') source.column = ds.columnNumber
    return { source }
  }
  const stack = f._debugStack?.stack
  if (typeof stack === 'string') {
    const frame = parseStackFrames(stack).find((fr) => !FRAMEWORK_FRAME.some((p) => fr.url.includes(p)))
    if (frame) return { stackFrame: frame }
  }
  return null
}

export function reactInfo(el: Element): ReactInfo {
  try {
    const components: string[] = []
    let src: Pick<ReactInfo, 'source' | 'stackFrame'> | null = null
    let f = findFiber(el)
    for (let depth = 0; f && depth < MAX_DEPTH; depth++, f = f.return ?? null) {
      const isHost = typeof f.type === 'string'
      const name = isHost ? null : typeName(f.type)
      const keep = name !== null && isUserComponent(name)
      if (keep && components.length < MAX_COMPONENTS) components.push(name)
      // Source: the element's own (host) fiber first — its _debugSource/_debugStack points at the
      // JSX inside the component that rendered it — then the nearest kept component fibers.
      if (!src && (isHost || keep)) src = sourceOf(f)
      if (components.length >= MAX_COMPONENTS && src) break
    }
    return { components, ...(src ?? {}) }
  } catch {
    return { components: [] }
  }
}
