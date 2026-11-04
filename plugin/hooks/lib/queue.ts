// Pure state machine for delivering browser instructions into the session.
// No `$` here: register.ts runs the effects and feeds results back as events.
import { formatInstruction } from './format.ts'
import type { Instruction, InstructionStatus, ProgressEvent } from './types.ts'

export type QueuePhase = 'idle' | 'polling' | 'submitting' | 'running' | 'paused'
export type QueueState = { phase: QueuePhase; current?: Instruction }
export type QueueEvent =
  | { type: 'tick' }
  | { type: 'polled'; instruction: Instruction | null }
  | { type: 'submitted' }
  | { type: 'submit-dropped'; reason: string }
  | { type: 'turn-complete'; isAborted: boolean }
  | { type: 'user-input' }
export type Effect =
  | { type: 'poll'; canTake: boolean }
  | { type: 'submit'; text: string }
  | { type: 'status'; id: string; status: InstructionStatus }
  | { type: 'progress'; ev: Omit<ProgressEvent, 'at'> }
export type StepResult = { state: QueueState; effects: Effect[] }

export const PAUSED_LABEL = 'Přerušeno – pokračuj zprávou v terminálu'
export const DONE_LABEL = 'Hotovo'
export const ABORTED_LABEL = 'Přerušeno'

// Reasons after which Claude Code refuses plugin input until the user types something.
const HOLD_REASONS = ['the session was stopped and nobody has sent input since', 'was removed from the queue before it ran']

export function isHoldReason(reason: string): boolean {
  return HOLD_REASONS.some((r) => reason.includes(r))
}

const same = (state: QueueState): StepResult => ({ state, effects: [] })

export function step(state: QueueState, ev: QueueEvent): StepResult {
  const { phase, current } = state
  switch (ev.type) {
    case 'tick':
      if (phase === 'idle') return { state: { phase: 'polling' }, effects: [{ type: 'poll', canTake: true }] }
      // A poll is already pending: do not poll again (it would take a second instruction).
      if (phase === 'polling') return same(state)
      return { state, effects: [{ type: 'poll', canTake: false }] }

    case 'polled':
      if (phase !== 'polling') return same(state)
      if (!ev.instruction) return { state: { phase: 'idle' }, effects: [] }
      return {
        state: { phase: 'submitting', current: ev.instruction },
        effects: [
          { type: 'submit', text: formatInstruction(ev.instruction) },
          { type: 'status', id: ev.instruction.id, status: 'sent' },
        ],
      }

    case 'submitted':
      if (phase !== 'submitting' || !current) return same(state)
      return { state: { phase: 'running', current }, effects: [{ type: 'status', id: current.id, status: 'running' }] }

    case 'submit-dropped':
      if (phase !== 'submitting' || !current) return same(state)
      if (isHoldReason(ev.reason)) {
        return {
          state: { phase: 'paused', current },
          effects: [
            { type: 'status', id: current.id, status: 'held' },
            { type: 'progress', ev: { kind: 'info', label: PAUSED_LABEL, instructionId: current.id } },
          ],
        }
      }
      // Any other refusal (e.g. --max-turns) is not retried.
      return {
        state: { phase: 'idle' },
        effects: [
          { type: 'status', id: current.id, status: 'aborted' },
          { type: 'progress', ev: { kind: 'info', label: `Nedoručeno: ${ev.reason}`, instructionId: current.id } },
        ],
      }

    case 'turn-complete':
      if (phase !== 'running' || !current) return same(state)
      if (!ev.isAborted) {
        return {
          state: { phase: 'idle' },
          effects: [
            { type: 'status', id: current.id, status: 'done' },
            { type: 'progress', ev: { kind: 'turn-done', label: DONE_LABEL, instructionId: current.id } },
          ],
        }
      }
      // Interrupted by the user: no automatic resend; wait for their next input.
      return {
        state: { phase: 'paused' },
        effects: [
          { type: 'status', id: current.id, status: 'aborted' },
          { type: 'progress', ev: { kind: 'turn-aborted', label: ABORTED_LABEL, instructionId: current.id } },
        ],
      }

    case 'user-input':
      if (phase !== 'paused') return same(state)
      if (current) return { state: { phase: 'submitting', current }, effects: [{ type: 'submit', text: formatInstruction(current) }] }
      return { state: { phase: 'idle' }, effects: [] }
  }
}
