import { describe, expect, it } from 'vitest'
import { parseInspectArgs, parseLaunchOutput, startText, statusText, STOPPED_TEXT, INVALID_TEXT, startFailedText } from '../../plugin/hooks/lib/inspect.ts'

describe('parseInspectArgs', () => {
  it('parses ports', () => {
    expect(parseInspectArgs('3000')).toEqual({ kind: 'start', port: 3000 })
    expect(parseInspectArgs(' 65535 ')).toEqual({ kind: 'start', port: 65535 })
  })
  it('parses stop and status', () => {
    expect(parseInspectArgs('stop')).toEqual({ kind: 'stop' })
    expect(parseInspectArgs('')).toEqual({ kind: 'status' })
    expect(parseInspectArgs('   ')).toEqual({ kind: 'status' })
    expect(parseInspectArgs(undefined as any)).toEqual({ kind: 'status' })
  })
  it('rejects invalid', () => {
    for (const a of ['0', '65536', 'abc', '-1', '30.5', '3000 4000', '1e3']) {
      expect(parseInspectArgs(a)).toEqual({ kind: 'invalid' })
    }
  })
})

describe('parseLaunchOutput', () => {
  const info = { port: 4000, token: 't', pid: 1, target: 3000 }
  it('parses info', () => {
    expect(parseLaunchOutput(JSON.stringify(info) + '\n')).toEqual({ ok: true, info })
  })
  it('parses error', () => {
    expect(parseLaunchOutput('{"error":"boom"}')).toEqual({ ok: false, reason: 'boom' })
  })
  it('handles garbage', () => {
    expect(parseLaunchOutput('nope', 'stderr text')).toEqual({ ok: false, reason: 'stderr text' })
    expect(parseLaunchOutput('', '')).toEqual({ ok: false, reason: 'invalid launcher output' })
  })
})

describe('texts', () => {
  const info = { port: 4000, token: 't', pid: 1, target: 3000 }
  it('are verbatim', () => {
    expect(startText(info)).toBe('open http://localhost:4000 (proxy for localhost:3000). Pick elements with ⌘C on macOS, Alt+C elsewhere.')
    expect(statusText(info)).toBe('active: http://localhost:4000 → :3000')
    expect(statusText(null)).toBe('inactive. Use /inspect <dev server port>')
    expect(statusText(null, true)).toBe('proxy isn’t running. Use /inspect <dev server port>')
    expect(statusText(info, true)).toBe('active: http://localhost:4000 → :3000')
    expect(STOPPED_TEXT).toBe('stopped')
    expect(INVALID_TEXT).toBe('give the dev server port, e.g. /inspect 3000')
    expect(startFailedText('x')).toBe('couldn’t start the proxy (x). Node 20+ is required.')
  })
})
