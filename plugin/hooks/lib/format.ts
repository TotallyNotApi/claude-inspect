import type { ElementContext, Instruction } from './types.ts'

export function quickActionText(action: 'delete' | 'improve'): string {
  return action === 'delete'
    ? 'Smaž tento element.'
    : 'Vylepši tento element (vzhled, texty, přístupnost) v duchu zbytku stránky.'
}

function tagLine(el: ElementContext): string {
  const attrs = Object.entries(el.attrs ?? {})
  const ordered = [
    ...attrs.filter(([k]) => k === 'id'),
    ...attrs.filter(([k]) => k === 'class'),
    ...attrs.filter(([k]) => k !== 'id' && k !== 'class'),
  ]
  const s = ordered.map(([k, v]) => ` ${k}="${v}"`).join('')
  return `<${el.tag}${s}>`
}

function elementLines(el: ElementContext): string[] {
  const lines = [`- text: ${JSON.stringify(el.text)}`, `- tag: ${tagLine(el)}`]
  if (el.sectionHeading) lines.push(`- sekce: ${JSON.stringify(el.sectionHeading)}`)
  const src = el.source ? `${el.source.file}:${el.source.line}` : ''
  if (el.components.length > 0) {
    lines.push(`- komponenta: ${el.components.join(' ← ')}${src ? ` (${src})` : ''}`)
  } else if (src) {
    lines.push(`- zdroj: ${src}`)
  }
  lines.push(`- HTML cesta: ${el.domPath}`, `- selektor: ${el.selector}`, `- html: ${el.outerHTML}`)
  return lines
}

export function formatInstruction(i: Instruction): string {
  let path = i.pageUrl
  try {
    const u = new URL(i.pageUrl)
    path = u.pathname + u.search
  } catch {}
  if (i.items.length === 1) {
    const it = i.items[0]
    return [
      `[web-inspect] Instrukce z prohlížeče, stránka ${path}`,
      '',
      it.instruction,
      '',
      'Element:',
      ...elementLines(it.element),
    ].join('\n')
  }
  const blocks = i.items.map((it, n) => [`${n + 1}) ${it.instruction}`, ...elementLines(it.element)].join('\n'))
  return [`[web-inspect] Dávka ${i.items.length} úprav z prohlížeče, stránka ${path}`, '', blocks.join('\n\n')].join('\n')
}
