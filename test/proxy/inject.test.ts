import { describe, it, expect } from 'vitest'
import { createInjector } from '../../src/proxy/inject.js'

const TAG = '<script src="/__web-inspect/overlay.js"></script>'

async function run(chunks: string[]): Promise<string> {
  const t = createInjector(TAG)
  const out: Buffer[] = []
  t.on('data', (c: Buffer) => out.push(Buffer.from(c)))
  const done = new Promise<void>((res, rej) => {
    t.on('end', res)
    t.on('error', rej)
  })
  for (const c of chunks) t.write(c)
  t.end()
  await done
  return Buffer.concat(out).toString('utf8')
}

describe('createInjector', () => {
  it('inserts right after <head>', async () => {
    expect(await run(['<html><head><title>x</title></head></html>'])).toBe(
      `<html><head>${TAG}<title>x</title></head></html>`,
    )
  })
  it('handles <head> with attributes', async () => {
    expect(await run(['<html><head lang="cs"><title>x</title>'])).toBe(
      `<html><head lang="cs">${TAG}<title>x</title>`,
    )
  })
  it('handles tag split across chunks, inserting once', async () => {
    expect(await run(['<html><he', 'ad><title>x</title>'])).toBe(`<html><head>${TAG}<title>x</title>`)
  })
  it('falls back to before </body> when there is no head', async () => {
    expect(await run(['<html><body>hi</body></html>'])).toBe(`<html><body>hi${TAG}</body></html>`)
  })
  it('appends at the end when neither head nor body exist', async () => {
    expect(await run(['<p>x</p>'])).toBe(`<p>x</p>${TAG}`)
  })
  it('inserts only once with two <head> occurrences', async () => {
    const out = await run(['<head></head><head></head>'])
    expect(out).toBe(`<head>${TAG}</head><head></head>`)
  })
  it('does not match <header>', async () => {
    expect(await run(['<header>a</header><head>b'])).toBe(`<header>a</header><head>${TAG}b`)
  })
  it('keeps multibyte characters split across chunks intact', async () => {
    const buf = Buffer.from('<head>č</head>')
    const t = createInjector(TAG)
    const out: Buffer[] = []
    t.on('data', (c: Buffer) => out.push(Buffer.from(c)))
    const done = new Promise<void>((r) => t.on('end', r))
    t.write(buf.subarray(0, 7))
    t.write(buf.subarray(7))
    t.end()
    await done
    expect(Buffer.concat(out).toString('utf8')).toBe(`<head>${TAG}č</head>`)
  })
})
