import { expect, test } from 'claude-code/testing'
import { step, PAUSED_LABEL } from '../hooks/lib/queue.ts'
import type { QueueState } from '../hooks/lib/queue.ts'
import { formatInstruction } from '../hooks/lib/format.ts'
import type { Instruction } from '../hooks/lib/types.ts'

const I: Instruction = {
  id: 'i1', createdAt: 0, pageUrl: 'http://localhost:4000/',
  items: [{ instruction: 'Zvětši', element: {
    text: 'A', tag: 'h1', attrs: {}, domPath: 'h1', selector: 'h1', components: [], outerHTML: '<h1>A</h1>',
  } }],
}
const TEXT = formatInstruction(I)
const STOPPED = 'the session was stopped and nobody has sent input since'
const REMOVED = 'the prompt was removed from the queue before it ran'

test('tick in idle starts a poll that may take an instruction', () => {
  expect(step({ phase: 'idle' }, { type: 'tick' })).toEqual({
    state: { phase: 'polling' }, effects: [{ type: 'poll', canTake: true }],
  })
})

test('tick while running, submitting or paused only sends a heartbeat', () => {
  for (const phase of ['running', 'submitting', 'paused'] as const) {
    const s: QueueState = { phase, current: I }
    expect(step(s, { type: 'tick' })).toEqual({ state: s, effects: [{ type: 'poll', canTake: false }] })
  }
})

test('tick while a poll is pending does nothing', () => {
  const s: QueueState = { phase: 'polling' }
  expect(step(s, { type: 'tick' })).toEqual({ state: s, effects: [] })
})

test('polled with an instruction submits it and marks it sent', () => {
  expect(step({ phase: 'polling' }, { type: 'polled', instruction: I })).toEqual({
    state: { phase: 'submitting', current: I },
    effects: [{ type: 'submit', text: TEXT }, { type: 'status', id: 'i1', status: 'sent' }],
  })
})

test('polled with null returns to idle', () => {
  expect(step({ phase: 'polling' }, { type: 'polled', instruction: null })).toEqual({ state: { phase: 'idle' }, effects: [] })
})

test('submitted marks the instruction running', () => {
  expect(step({ phase: 'submitting', current: I }, { type: 'submitted' })).toEqual({
    state: { phase: 'running', current: I }, effects: [{ type: 'status', id: 'i1', status: 'running' }],
  })
})

test('submit dropped after an interruption holds the instruction', () => {
  for (const reason of [STOPPED, REMOVED]) {
    expect(step({ phase: 'submitting', current: I }, { type: 'submit-dropped', reason })).toEqual({
      state: { phase: 'paused', current: I },
      effects: [
        { type: 'status', id: 'i1', status: 'held' },
        { type: 'progress', ev: { kind: 'info', label: PAUSED_LABEL, instructionId: 'i1' } },
      ],
    })
  }
  expect(PAUSED_LABEL).toBe('Interrupted. Send a message in the terminal to continue')
})

test('turn complete finishes or aborts the running instruction', () => {
  expect(step({ phase: 'running', current: I }, { type: 'turn-complete', isAborted: false })).toEqual({
    state: { phase: 'idle' },
    effects: [
      { type: 'status', id: 'i1', status: 'done' },
      { type: 'progress', ev: { kind: 'turn-done', label: 'Hotovo', instructionId: 'i1' } },
    ],
  })
  expect(step({ phase: 'running', current: I }, { type: 'turn-complete', isAborted: true })).toEqual({
    state: { phase: 'paused' },
    effects: [
      { type: 'status', id: 'i1', status: 'aborted' },
      { type: 'progress', ev: { kind: 'turn-aborted', label: 'Interrupted', instructionId: 'i1' } },
    ],
  })
})

test('user input while paused resubmits a held instruction, else returns to idle', () => {
  expect(step({ phase: 'paused', current: I }, { type: 'user-input' })).toEqual({
    state: { phase: 'submitting', current: I }, effects: [{ type: 'submit', text: TEXT }],
  })
  expect(step({ phase: 'paused' }, { type: 'user-input' })).toEqual({ state: { phase: 'idle' }, effects: [] })
})

test('events that do not fit the phase change nothing', () => {
  const cases: [QueueState, any][] = [
    [{ phase: 'idle' }, { type: 'turn-complete', isAborted: false }],
    [{ phase: 'submitting', current: I }, { type: 'turn-complete', isAborted: true }],
    [{ phase: 'idle' }, { type: 'user-input' }],
    [{ phase: 'running', current: I }, { type: 'user-input' }],
    [{ phase: 'running', current: I }, { type: 'polled', instruction: null }],
    [{ phase: 'idle' }, { type: 'submitted' }],
    [{ phase: 'paused' }, { type: 'submit-dropped', reason: STOPPED }],
  ]
  for (const [s, ev] of cases) expect(step(s, ev)).toEqual({ state: s, effects: [] })
})

test('submit dropped for another reason gives the instruction up', () => {
  expect(step({ phase: 'submitting', current: I }, { type: 'submit-dropped', reason: 'the run reached its --max-turns limit' })).toEqual({
    state: { phase: 'idle' },
    effects: [
      { type: 'status', id: 'i1', status: 'aborted' },
      { type: 'progress', ev: { kind: 'info', label: 'Not delivered: the run reached its --max-turns limit', instructionId: 'i1' } },
    ],
  })
})
