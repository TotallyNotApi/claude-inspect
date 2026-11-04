// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { buildElementContext, domPath, isGeneratedClass, sectionHeading, uniqueSelector } from '../../src/overlay/context.ts'

const FIXTURE = `
<header><h1>Web</h1></header>
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

const badge = () => document.querySelector('span.badge')!

beforeEach(() => {
  document.body.innerHTML = FIXTURE
})

describe('domPath', () => {
  it('builds the path from main down', () => {
    expect(domPath(badge())).toBe('main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge')
  })
  it('starts at first body child when there is no main', () => {
    document.body.innerHTML = '<div class="wrap"><p class="a">x</p></div>'
    expect(domPath(document.querySelector('p')!)).toBe('div.wrap > p.a')
  })
  it('omits generated classes and keeps at most two others', () => {
    document.body.innerHTML = '<main><div class="css-1a2b Card__title___3xYz styles__a1b2c3 one two three">x</div></main>'
    expect(domPath(document.querySelector('div')!)).toBe('main > div.one.two')
  })
  it('does not add nth-child when id is present', () => {
    document.body.innerHTML = '<main><p id="a">1</p><p id="b">2</p></main>'
    expect(domPath(document.getElementById('b')!)).toBe('main > p#b')
  })
})

describe('isGeneratedClass', () => {
  it.each(['css-1a2b3c', 'sc-bdnylx', 'jsx-123456', 'emotion-0', 'Card__title___3xYz', 'styles__a1b2c3'])('%s is generated', (c) => {
    expect(isGeneratedClass(c)).toBe(true)
  })
  it.each(['plan', 'badge', 'btn-primary', 'card__title', 'is-active', 'css'])('%s is not generated', (c) => {
    expect(isGeneratedClass(c)).toBe(false)
  })
})

describe('uniqueSelector', () => {
  it('uses id first', () => {
    expect(uniqueSelector(document.getElementById('pricing')!)).toBe('#pricing')
  })
  it('uses data-testid', () => {
    document.body.innerHTML = '<main><button data-testid="buy">x</button><button>y</button></main>'
    expect(uniqueSelector(document.querySelector('button')!)).toBe('[data-testid="buy"]')
  })
  it('shortens the domPath while unique', () => {
    expect(uniqueSelector(badge())).toBe('span.badge')
  })
  it('keeps enough segments to be unique', () => {
    const el = document.querySelectorAll('div.plan')[1]!
    const sel = uniqueSelector(el)
    expect(document.querySelectorAll(sel)).toHaveLength(1)
    expect(document.querySelector(sel)).toBe(el)
  })
  it('works for body', () => {
    expect(document.querySelector(uniqueSelector(document.body))).toBe(document.body)
  })
})

describe('sectionHeading', () => {
  it('finds the heading of the enclosing section', () => {
    expect(sectionHeading(badge())).toBe('Ceník')
  })
  it('prefers aria-label', () => {
    document.body.innerHTML = '<section aria-label="  Cena   plánů "><h2>Other</h2><p>x</p></section>'
    expect(sectionHeading(document.querySelector('p')!)).toBe('Cena plánů')
  })
  it('falls back to nearest preceding heading', () => {
    document.body.innerHTML = '<h1>A</h1><div><h2>B</h2></div><div><p>x</p></div>'
    expect(sectionHeading(document.querySelector('p')!)).toBe('B')
  })
  it('is undefined with no heading', () => {
    document.body.innerHTML = '<p>x</p>'
    expect(sectionHeading(document.querySelector('p')!)).toBeUndefined()
  })
  it('trims to 80 chars', () => {
    document.body.innerHTML = `<section><h2>${'a'.repeat(200)}</h2><p>x</p></section>`
    expect(sectionHeading(document.querySelector('p')!)).toHaveLength(80)
  })
})

describe('buildElementContext', () => {
  it('describes the badge', () => {
    const c = buildElementContext(badge())
    expect(c.tag).toBe('span')
    expect(c.text).toBe('Nejoblíbenější')
    expect(c.attrs).toEqual({ class: 'badge' })
    expect(c.domPath).toBe('main > section#pricing > div.plans > div.plan:nth-child(2) > span.badge')
    expect(document.querySelectorAll(c.selector)).toHaveLength(1)
    expect(c.sectionHeading).toBe('Ceník')
    expect(c.outerHTML).toBe('<span class="badge">Nejoblíbenější</span>')
  })
  it('only keeps allowlisted attrs', () => {
    document.body.innerHTML = '<a id="l" href="/x" style="color:red" onclick="x()" data-testid="t" aria-label="L" tabindex="1">go</a>'
    expect(buildElementContext(document.querySelector('a')!).attrs).toEqual({ id: 'l', href: '/x', 'data-testid': 't', 'aria-label': 'L' })
  })
  it('collapses whitespace in text', () => {
    document.body.innerHTML = '<p>a \n\n   b\t c</p>'
    expect(buildElementContext(document.querySelector('p')!).text).toBe('a b c')
  })
  it('truncates huge body text and html', () => {
    document.body.innerHTML = `<p>${'x'.repeat(10000)}</p>`
    const c = buildElementContext(document.body)
    expect(c.text.length).toBe(201)
    expect(c.text.endsWith('…')).toBe(true)
    expect(c.outerHTML.length).toBe(601)
    expect(c.outerHTML.endsWith('…')).toBe(true)
  })
  it('does not crash on html', () => {
    const c = buildElementContext(document.documentElement)
    expect(c.tag).toBe('html')
  })
})
