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
  // React 19 dev: Server Components that produced this fiber (ReactComponentInfo), outermost first;
  // may also hold timing ({ time }) and awaited-I/O entries, which have no `name`.
  _debugInfo?: unknown
}

const MAX_COMPONENTS = 5
const MAX_DEPTH = 500
// Next.js App Router internals (client tree and server Metadata/Viewport trees, Next 13–15), always
// dropped: names no app would plausibly reuse.
const NEXT_INTERNALS = new Set([
  'AppDevOverlay',
  'AppDevOverlayErrorBoundary',
  'AppRouter',
  'AsyncMetadataOutlet',
  'ClientPageRoot', // wraps every 'use client' page
  'ClientSegmentRoot', // wraps every 'use client' layout
  'DevOverlay',
  'DevRootHTTPAccessFallbackBoundary',
  'DevRootNotFoundBoundary',
  'ErrorBoundaryHandler',
  'HTTPAccessFallbackBoundary',
  'HTTPAccessFallbackErrorBoundary',
  'InnerLayoutRouter',
  'InnerScrollAndFocusHandler',
  'LayoutRouter',
  'MetadataBoundary',
  'MetadataOutlet',
  'MetadataTree',
  'NotFoundErrorBoundary',
  'OuterLayoutRouter',
  'OutletBoundary',
  'ReactDevOverlay',
  'RedirectErrorBoundary',
  'RenderFromTemplateContext',
  'RootErrorBoundary',
  'ScrollAndFocusHandler',
  'SegmentViewNode',
  'ServerRoot',
  'ViewportBoundary',
  'ViewportTree',
])
// Next.js internals whose names a user component could also have: dropped unless the element was
// demonstrably created in user code (see createdInUserCode).
const NEXT_GENERIC = new Set(['ErrorBoundary', 'Head', 'HotReload', 'LoadingBoundary', 'NotFoundBoundary', 'RedirectBoundary', 'Root', 'Router'])
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

const isFrameworkUrl = (url: string) => FRAMEWORK_FRAME.some((p) => url.includes(p))
const looksLikeUrl = (url: string) => /^[a-z][\w+.-]*:\/\//i.test(url) || url.startsWith('/')

// Was this fiber's element created in user code? true/false when debug info says so, null if unknown.
function createdInUserCode(f: Fiber): boolean | null {
  const ds = f._debugSource
  if (ds && typeof ds.fileName === 'string') return !ds.fileName.includes('node_modules')
  const stack = f._debugStack?.stack
  if (typeof stack !== 'string') return null
  const frames = parseStackFrames(stack).filter((fr) => looksLikeUrl(fr.url))
  if (!frames.length) return null
  return frames.some((fr) => !isFrameworkUrl(fr.url))
}

// Same question for a Server Component's ReactComponentInfo (`stack`: [[fn, url, line, col, …]]).
function infoCreatedInUserCode(stack: unknown): boolean | null {
  if (!Array.isArray(stack)) return null
  const urls = stack.map((e) => (Array.isArray(e) ? e[1] : null)).filter((u): u is string => typeof u === 'string' && looksLikeUrl(u))
  if (!urls.length) return null
  return urls.some((u) => !isFrameworkUrl(u))
}

function isUserComponent(name: string, userCode: () => boolean | null): boolean {
  if (!/^[A-Z]/.test(name) || /(Provider|Context)$/.test(name) || NEXT_INTERNALS.has(name)) return false
  return !NEXT_GENERIC.has(name) || userCode() === true
}

// Names of the Server Components in fiber._debugInfo, closest first.
function serverComponents(f: Fiber, seen: Set<unknown>): string[] {
  const di = f._debugInfo
  if (!Array.isArray(di)) return []
  const out: string[] = []
  for (let i = di.length - 1; i >= 0; i--) {
    const e = di[i] as { name?: unknown; stack?: unknown } | null
    if (!e || typeof e !== 'object' || typeof e.name !== 'string' || seen.has(e)) continue
    seen.add(e)
    const name = e.name
    if (isUserComponent(name, () => infoCreatedInUserCode(e.stack))) out.push(name)
  }
  return out
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

const WEBPACK_INTERNAL = 'webpack-internal:///'
// React 19 replays Server Component stacks in the browser under a fake origin:
// `about://React/Server/<original url>` (or `rsc://React/Server/…`), see react-server-dom.
const SERVER_FRAME = /^(?:about|rsc):\/\/React\/[^/]+\//

// `webpack-internal:///(app-pages-browser)/./src/x.tsx?abc` → `src/x.tsx`
export function webpackInternalPath(url: string): string {
  let p = url.slice(WEBPACK_INTERNAL.length).replace(/[?#].*$/, '')
  p = p.replace(/^\([^)]*\)\//, '')
  while (p.startsWith('./')) p = p.slice(2)
  return p
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
    if (!frame) return null
    const url = frame.url.replace(SERVER_FRAME, '')
    const at = { line: frame.line, column: frame.column }
    // Next.js webpack dev (eval-source-map) and replayed Server Component frames: not fetchable
    // as JS, but the URL names the file. Line/column are of the compiled module, so the source is
    // only approximate (Controller Ruling R12); the stackFrame lets the proxy refine it through
    // Next's /__nextjs_source-map, falling back to this source when that fails.
    if (url.startsWith(WEBPACK_INTERNAL)) return { source: { file: webpackInternalPath(url), ...at }, stackFrame: frame }
    // Absolute path (the overlay does not know the project root; Claude can still open it).
    if (url.startsWith('file://')) {
      const file = decodeURIComponent(url.slice('file://'.length).replace(/[?#].*$/, ''))
      return { source: { file, ...at }, stackFrame: frame }
    }
    return { stackFrame: url === frame.url ? frame : { ...frame, url } }
  }
  return null
}

export function reactInfo(el: Element): ReactInfo {
  try {
    const components: string[] = []
    let src: Pick<ReactInfo, 'source' | 'stackFrame'> | null = null
    const seenInfo = new Set<unknown>()
    const add = (name: string) => {
      // Dedupe consecutive repeats (e.g. memo wrapper + inner fiber both named `Card`).
      if (components.length < MAX_COMPONENTS && components[components.length - 1] !== name) components.push(name)
    }
    let f = findFiber(el)
    for (let depth = 0; f && depth < MAX_DEPTH; depth++, f = f.return ?? null) {
      const fiber = f
      const isHost = typeof fiber.type === 'string'
      const name = isHost ? null : typeName(fiber.type)
      const keep = name !== null && isUserComponent(name, () => createdInUserCode(fiber))
      if (keep) add(name)
      // Server Components (no fiber of their own) that rendered this fiber sit just outside it.
      for (const server of serverComponents(fiber, seenInfo)) add(server)
      // Source: the nearest fiber, of either kind, that has a usable _debugSource/_debugStack —
      // host fibers (whose debug info points at the JSX inside the component that rendered them)
      // and components that passed the name filter; filtered-out components are skipped.
      if (!src && (isHost || keep)) src = sourceOf(f)
      if (components.length >= MAX_COMPONENTS && src) break
    }
    return { components, ...(src ?? {}) }
  } catch {
    return { components: [] }
  }
}
