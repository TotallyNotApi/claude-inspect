export type SourceLoc = { file: string; line: number; column?: number }
export type ElementContext = {
  text: string
  tag: string
  attrs: Record<string, string>
  domPath: string
  selector: string
  components: string[]
  source?: SourceLoc
  sectionHeading?: string
  outerHTML: string
}
export type InstructionItem = { instruction: string; element: ElementContext }
export type Instruction = { id: string; createdAt: number; pageUrl: string; items: InstructionItem[] }
export type InstructionStatus = 'queued' | 'sent' | 'running' | 'done' | 'aborted' | 'held'
export type ProgressKind = 'tool' | 'waiting-permission' | 'turn-done' | 'turn-aborted' | 'info'
export type ProgressEvent = { kind: ProgressKind; label: string; instructionId?: string; at: number }
export type QueueEntry = { id: string; status: InstructionStatus; summary: string }
export type Snapshot = { queue: QueueEntry[]; progress: ProgressEvent[] }
export type LaunchInfo = { port: number; token: string; pid: number; target: number }
