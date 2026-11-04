import { expect, test } from 'claude-code/testing'
import { formatInstruction, quickActionText } from '../hooks/lib/format.ts'
import type { ElementContext, Instruction } from '../hooks/lib/types.ts'

const badge: ElementContext = {
  text: 'Nejoblíbenější',
  tag: 'span',
  attrs: { class: 'badge' },
  domPath: 'main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge',
  selector: '#pricing .plan:nth-child(2) > .badge',
  components: ['PlanCard', 'Pricing'],
  source: { file: 'src/components/PlanCard.tsx', line: 8 },
  sectionHeading: 'Ceník',
  outerHTML: '<span class="badge">Nejoblíbenější</span>',
}

test('formats a single delete instruction', () => {
  const i: Instruction = {
    id: '1', createdAt: 0, pageUrl: 'http://localhost:4000/pricing',
    items: [{ instruction: quickActionText('delete'), element: badge }],
  }
  expect(formatInstruction(i)).toBe(`[web-inspect] Instrukce z prohlížeče, stránka /pricing

Smaž tento element.

Element:
- text: "Nejoblíbenější"
- tag: <span class="badge">
- sekce: "Ceník"
- komponenta: PlanCard ← Pricing (src/components/PlanCard.tsx:8)
- HTML cesta: main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge
- selektor: #pricing .plan:nth-child(2) > .badge
- html: <span class="badge">Nejoblíbenější</span>`)
})

test('formats a batch with numbered elements', () => {
  const i: Instruction = {
    id: '2', createdAt: 0, pageUrl: 'http://localhost:4000/',
    items: [
      { instruction: 'První', element: badge },
      { instruction: 'Druhá', element: { ...badge, text: 'B' } },
    ],
  }
  const out = formatInstruction(i)
  expect(out.startsWith('[web-inspect] Dávka 2 úprav z prohlížeče, stránka /\n\n1) První\n- text: "Nejoblíbenější"')).toBe(true)
  expect(out).toContain('\n\n2) Druhá\n- text: "B"')
})

test('omits missing fields', () => {
  const base: ElementContext = { ...badge, components: [], source: undefined, sectionHeading: undefined }
  const none = formatInstruction({ id: '3', createdAt: 0, pageUrl: 'http://x/a?b=1', items: [{ instruction: 'x', element: base }] })
  expect(none).not.toContain('komponenta:')
  expect(none).not.toContain('sekce:')
  expect(none).not.toContain('zdroj:')
  expect(none).toContain('stránka /a?b=1')
  const src = formatInstruction({ id: '4', createdAt: 0, pageUrl: 'http://x/', items: [{ instruction: 'x', element: { ...base, source: { file: 'src/x.tsx', line: 3 } } }] })
  expect(src).toContain('- zdroj: src/x.tsx:3')
  expect(src).not.toContain('komponenta:')
})

test('quickActionText', () => {
  expect(quickActionText('delete')).toBe('Smaž tento element.')
  expect(quickActionText('improve')).toBe('Vylepši tento element (vzhled, texty, přístupnost) v duchu zbytku stránky.')
})
