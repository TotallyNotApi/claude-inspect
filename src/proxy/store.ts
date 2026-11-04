import { randomUUID } from 'node:crypto'
import type { Instruction, InstructionItem, InstructionStatus, ProgressEvent, Snapshot } from '../../plugin/hooks/lib/types.js'

const MAX_PROGRESS = 20
const MAX_ENTRIES = 50
const SUMMARY_LEN = 60

type Entry = { instruction: Instruction; status: InstructionStatus }

/** In-memory instruction queue. Single-threaded, so take() is atomic by construction. */
export class InstructionStore {
  private entries: Entry[] = []
  private progress: ProgressEvent[] = []
  private listeners = new Set<() => void>()

  add(pageUrl: string, items: InstructionItem[]): Instruction {
    const instruction: Instruction = { id: randomUUID(), createdAt: Date.now(), pageUrl, items }
    this.entries.push({ instruction, status: 'queued' })
    // Bound memory: drop oldest finished entries beyond the cap.
    while (this.entries.length > MAX_ENTRIES) {
      const i = this.entries.findIndex((e) => e.status === 'done' || e.status === 'aborted')
      if (i < 0) break
      this.entries.splice(i, 1)
    }
    this.emit()
    return instruction
  }

  take(): Instruction | null {
    const e = this.entries.find((x) => x.status === 'queued')
    if (!e) return null
    e.status = 'sent'
    this.emit()
    return e.instruction
  }

  setStatus(id: string, status: InstructionStatus): boolean {
    const e = this.entries.find((x) => x.instruction.id === id)
    if (!e) return false
    e.status = status
    this.emit()
    return true
  }

  /** aborted/held -> queued at the front of the queue. Other statuses return false. */
  resend(id: string): boolean {
    const i = this.entries.findIndex((x) => x.instruction.id === id)
    if (i < 0) return false
    const e = this.entries[i]
    if (e.status !== 'aborted' && e.status !== 'held') return false
    this.entries.splice(i, 1)
    e.status = 'queued'
    this.entries.unshift(e)
    this.emit()
    return true
  }

  has(id: string): boolean {
    return this.entries.some((x) => x.instruction.id === id)
  }

  pushProgress(ev: ProgressEvent): void {
    this.progress.push(ev)
    if (this.progress.length > MAX_PROGRESS) this.progress.splice(0, this.progress.length - MAX_PROGRESS)
    this.emit()
  }

  snapshot(): Snapshot {
    return {
      queue: this.entries.map((e) => ({
        id: e.instruction.id,
        status: e.status,
        summary: (e.instruction.items[0]?.instruction ?? '').slice(0, SUMMARY_LEN),
      })),
      progress: [...this.progress],
    }
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb()
  }
}
