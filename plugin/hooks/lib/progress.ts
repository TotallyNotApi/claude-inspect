// Czech progress labels for the browser overlay. Pure.

function basename(p: unknown): string | null {
  if (typeof p !== 'string' || !p) return null
  const seg = p.split(/[\\/]/).filter(Boolean)
  return seg.length ? seg[seg.length - 1]! : null
}

export function toolLabel(tool: string, input: Record<string, unknown>): string {
  const fallback = `používá ${tool}`
  switch (tool) {
    case 'Read': {
      const b = basename(input.file_path)
      return b ? `čte ${b}` : fallback
    }
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit': {
      const b = basename(input.file_path ?? input.notebook_path)
      return b ? `upravuje ${b}` : fallback
    }
    case 'Bash': {
      const c = input.command
      return typeof c === 'string' && c ? `spouští ${c.slice(0, 40)}` : fallback
    }
    case 'Grep':
    case 'Glob': {
      const p = input.pattern
      return typeof p === 'string' && p ? `hledá ${p}` : fallback
    }
    case 'Agent':
    case 'Task':
      return 'spouští subagenta'
    default:
      return fallback
  }
}
