import { Transform } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

const HEAD_RE = /<head(?=[\s>\/])[^>]*>/i
const BODY_CLOSE_RE = /<\/body\s*>/i

/**
 * Streaming HTML transform: inserts `tag` right after the first `<head ...>`;
 * if no head shows up, before the first `</body>`; otherwise at the very end.
 * Text before the insertion point is passed on as soon as it cannot be part of
 * a tag split across chunks. After the injection everything is passed through.
 */
export function createInjector(tag: string): Transform {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let done = false

  const process = (final: boolean): string => {
    const head = HEAD_RE.exec(pending)
    if (head) {
      const end = head.index + head[0].length
      const out = pending.slice(0, end) + tag
      const rest = pending.slice(end)
      pending = ''
      done = true
      return out + rest
    }
    const body = BODY_CLOSE_RE.exec(pending)
    if (body) {
      const out = pending.slice(0, body.index) + tag
      const rest = pending.slice(body.index)
      pending = ''
      done = true
      return out + rest
    }
    if (final) {
      const out = pending + tag
      pending = ''
      done = true
      return out
    }
    // Hold back a possibly incomplete tag at the end (from the last '<').
    const lt = pending.lastIndexOf('<')
    if (lt === -1 || pending.indexOf('>', lt) !== -1) {
      // Even with a closed last tag, keep nothing back unless it could still be
      // part of a "</body>" / "<head" prefix; closed tags cannot be.
      const out = pending
      pending = ''
      return out
    }
    const out = pending.slice(0, lt)
    pending = pending.slice(lt)
    return out
  }

  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      // Always decode (even after injecting) so multibyte characters split
      // across chunks are never corrupted.
      pending += decoder.write(chunk)
      if (done) {
        const out = pending
        pending = ''
        return cb(null, out)
      }
      const out = process(false)
      cb(null, out)
    },
    flush(cb) {
      pending += decoder.end()
      if (done) return cb(null, pending)
      cb(null, process(true))
    },
  })
}
