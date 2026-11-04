import type { ElementContext } from '../../plugin/hooks/lib/types.ts'

const TEXT_MAX = 200
const HTML_MAX = 600
const HEADING_MAX = 80
const ATTR_ALLOWLIST = ['id', 'class', 'role', 'aria-label', 'href', 'src', 'alt', 'type', 'name', 'data-testid']

// CSS-in-JS / CSS-modules class names: `css-1a2b`, `sc-bdnylx`, `jsx-123`, `emotion-0`,
// and `Block__elem___3xYz` / `styles__a1b2c3` (a `__` followed by a part containing a digit = hash).
// Plain BEM like `card__title` stays.
const GENERATED_PREFIX = /^(css|sc|jsx|emotion)-[\w-]+$/
const GENERATED_HASHED = /__[\w-]*\d/
export function isGeneratedClass(name: string): boolean {
  return GENERATED_PREFIX.test(name) || GENERATED_HASHED.test(name)
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()
const truncate = (s: string, max: number) => (s.length > max ? s.slice(0, max) + '…' : s)

function cssEscape(s: string): string {
  const esc = (globalThis as { CSS?: { escape?: (v: string) => string } }).CSS?.escape
  if (esc) return esc(s)
  return s.replace(/^\d/, (d) => `\\3${d} `).replace(/[^\w-]/g, (c) => `\\${c}`)
}

function segment(el: Element): string {
  const tag = el.tagName.toLowerCase()
  if (el.id) return `${tag}#${cssEscape(el.id)}`
  const classes = Array.from(el.classList)
    .filter((c) => !isGeneratedClass(c))
    .slice(0, 2)
    .map((c) => `.${cssEscape(c)}`)
    .join('')
  let seg = tag + classes
  const parent = el.parentElement
  if (parent) {
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
    if (same.length > 1) seg += `:nth-child(${Array.from(parent.children).indexOf(el) + 1})`
  }
  return seg
}

function segments(el: Element): string[] {
  const body = el.ownerDocument.body
  if (el === el.ownerDocument.documentElement || el === body) return [el.tagName.toLowerCase()]
  const chain: Element[] = []
  let cur: Element | null = el
  while (cur && cur !== body && cur !== el.ownerDocument.documentElement) {
    chain.unshift(cur)
    if (cur.tagName === 'MAIN') break
    cur = cur.parentElement
  }
  return chain.map(segment)
}

export function domPath(el: Element): string {
  return segments(el).join(' > ')
}

export function uniqueSelector(el: Element): string {
  const doc = el.ownerDocument
  const isUnique = (sel: string) => {
    try {
      const found = doc.querySelectorAll(sel)
      return found.length === 1 && found[0] === el
    } catch {
      return false
    }
  }
  if (el.id) {
    const sel = `#${cssEscape(el.id)}`
    if (isUnique(sel)) return sel
  }
  const testId = el.getAttribute('data-testid')
  if (testId) {
    const sel = `[data-testid="${testId.replace(/["\\]/g, '\\$&')}"]`
    if (isUnique(sel)) return sel
  }
  const segs = segments(el)
  for (let i = segs.length - 1; i >= 0; i--) {
    const sel = segs.slice(i).join(' > ')
    if (isUnique(sel)) return sel
  }
  return segs.join(' > ')
}

const HEADING = 'h1,h2,h3'
const SECTION_SEL = 'section,article,header,footer,[role=region]'

export function sectionHeading(el: Element): string | undefined {
  const out = (s: string | null | undefined) => {
    const t = collapse(s ?? '')
    return t ? t.slice(0, HEADING_MAX) : undefined
  }
  for (let a: Element | null = el; a; a = a.parentElement) {
    if (!a.matches(SECTION_SEL)) continue
    const r = out(a.getAttribute('aria-label')) ?? out(a.querySelector(HEADING)?.textContent)
    if (r) return r
  }
  const headings = Array.from(el.ownerDocument.querySelectorAll(HEADING))
  for (let i = headings.length - 1; i >= 0; i--) {
    const h = headings[i]!
    if (h !== el && !el.contains(h) && h.compareDocumentPosition(el) & 4 /* FOLLOWING */) {
      const r = out(h.textContent)
      if (r) return r
    }
  }
  return undefined
}

function elementText(el: Element): string {
  const inner = (el as HTMLElement).innerText
  const t = typeof inner === 'string' ? collapse(inner) : ''
  return t || collapse(el.textContent ?? '')
}

export function buildElementContext(el: Element): Omit<ElementContext, 'components' | 'source'> {
  const attrs: Record<string, string> = {}
  for (const name of ATTR_ALLOWLIST) {
    const v = el.getAttribute(name)
    if (v !== null) attrs[name] = truncate(v, TEXT_MAX)
  }
  const ctx: Omit<ElementContext, 'components' | 'source'> = {
    text: truncate(elementText(el), TEXT_MAX),
    tag: el.tagName.toLowerCase(),
    attrs,
    domPath: domPath(el),
    selector: uniqueSelector(el),
    outerHTML: truncate(el.outerHTML, HTML_MAX),
  }
  const heading = sectionHeading(el)
  if (heading) ctx.sectionHeading = heading
  return ctx
}
