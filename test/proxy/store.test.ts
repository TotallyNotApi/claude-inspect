import { describe, expect, it } from 'vitest'
import { InstructionStore } from '../../src/proxy/store.js'
import type { InstructionItem } from '../../plugin/hooks/lib/types.js'

const item = (instruction: string): InstructionItem => ({
  instruction,
  element: { text: '', tag: 'div', attrs: {}, domPath: 'div', selector: 'div', components: [], outerHTML: '<div></div>' },
})

describe('InstructionStore', () => {
  it('take() is FIFO and marks sent', () => {
    const s = new InstructionStore()
    const a = s.add('http://x/', [item('a')])
    const b = s.add('http://x/', [item('b')])
    expect(s.take()?.id).toBe(a.id)
    expect(s.snapshot().queue[0].status).toBe('sent')
    expect(s.take()?.id).toBe(b.id)
    expect(s.take()).toBeNull()
  })

  it('resend puts aborted at front as queued; done returns false', () => {
    const s = new InstructionStore()
    const a = s.add('u', [item('a')])
    const b = s.add('u', [item('b')])
    s.take()
    s.setStatus(a.id, 'aborted')
    expect(s.resend(a.id)).toBe(true)
    expect(s.take()?.id).toBe(a.id)
    s.setStatus(b.id, 'done')
    expect(s.resend(b.id)).toBe(false)
    expect(s.resend('nope')).toBe(false)
  })

  it('resend puts instruction ahead of other queued ones', () => {
    const s = new InstructionStore()
    const a = s.add('u', [item('a')])
    s.take()
    const b = s.add('u', [item('b')])
    s.setStatus(a.id, 'held')
    s.resend(a.id)
    expect(s.take()?.id).toBe(a.id)
    expect(s.take()?.id).toBe(b.id)
  })

  it('setStatus returns false for unknown id', () => {
    expect(new InstructionStore().setStatus('x', 'done')).toBe(false)
  })

  it('progress keeps last 20', () => {
    const s = new InstructionStore()
    for (let i = 0; i < 25; i++) s.pushProgress({ kind: 'info', label: String(i), at: i })
    const p = s.snapshot().progress
    expect(p).toHaveLength(20)
    expect(p[0].label).toBe('5')
    expect(p[19].label).toBe('24')
  })

  it('summary is first instruction truncated to 60 chars', () => {
    const s = new InstructionStore()
    s.add('u', [item('x'.repeat(100)), item('second')])
    expect(s.snapshot().queue[0].summary).toBe('x'.repeat(60))
  })

  it('onChange fires on changes and can unsubscribe', () => {
    const s = new InstructionStore()
    let n = 0
    const off = s.onChange(() => n++)
    s.add('u', [item('a')])
    s.pushProgress({ kind: 'info', label: 'l', at: 1 })
    expect(n).toBe(2)
    off()
    s.add('u', [item('b')])
    expect(n).toBe(2)
  })
})
