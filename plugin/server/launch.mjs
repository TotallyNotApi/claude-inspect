// Starts the web-inspect proxy detached, waits until it is ready, prints one
// JSON line (LaunchInfo or { error }) and exits. Usage:
//   node launch.mjs --target <port> [--port <port>] [--cwd <dir>]
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const READY_TIMEOUT_MS = 5000

function fail(message) {
  process.stdout.write(JSON.stringify({ error: message }) + '\n')
  process.exit(1)
}

let values
try {
  ;({ values } = parseArgs({
    options: { target: { type: 'string' }, port: { type: 'string' }, cwd: { type: 'string' } },
  }))
} catch (e) {
  fail(`invalid arguments: ${e.message}`)
}

const target = Number(values.target)
if (values.target === undefined || !/^\d+$/.test(values.target) || target < 1 || target > 65535) {
  fail(`invalid --target: expected an integer 1-65535, got ${JSON.stringify(values.target)}`)
}
if (values.port !== undefined && !/^\d+$/.test(values.port)) {
  fail(`invalid --port: ${JSON.stringify(values.port)}`)
}

const here = dirname(fileURLToPath(import.meta.url))
const readyFile = join(tmpdir(), `web-inspect-ready-${process.pid}-${randomBytes(4).toString('hex')}.json`)
const logTmp = join(tmpdir(), `web-inspect-launch-${process.pid}.log`)

const args = [join(here, 'proxy.mjs'), '--target', String(target), '--cwd', values.cwd ?? process.cwd(), '--ready-file', readyFile]
if (values.port !== undefined) args.push('--port', values.port)

// The log is named after the proxy pid, which is only known after spawn, so
// stdio goes to a temp file that is renamed afterwards (same fd stays valid).
const logFd = openSync(logTmp, 'w')
const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', logFd, logFd] })
closeSync(logFd)

let exited = false
child.on('exit', (code) => {
  exited = code ?? -1
})
child.on('error', (e) => fail(`could not start proxy: ${e.message}`))
child.unref()

let logPath = logTmp
if (child.pid) {
  const named = join(tmpdir(), `web-inspect-${child.pid}.log`)
  try {
    renameSync(logTmp, named)
    logPath = named
  } catch {}
}

function logTail() {
  try {
    return readFileSync(logPath, 'utf8').trim().split('\n').slice(-5).join('\n')
  } catch {
    return ''
  }
}

const deadline = Date.now() + READY_TIMEOUT_MS
while (Date.now() < deadline) {
  if (existsSync(readyFile)) {
    let info
    try {
      info = JSON.parse(readFileSync(readyFile, 'utf8'))
    } catch {
      info = undefined // rename is atomic, but be tolerant
    }
    if (info) {
      rmSync(readyFile, { force: true })
      process.stdout.write(JSON.stringify(info) + '\n')
      process.exit(0)
    }
  }
  if (exited !== false) {
    const tail = logTail()
    fail(`proxy exited with code ${exited} before becoming ready${tail ? `: ${tail}` : ''} (log: ${logPath})`)
  }
  await new Promise((r) => setTimeout(r, 25))
}

try {
  process.kill(child.pid, 'SIGTERM')
} catch {}
const tail = logTail()
fail(`proxy not ready after ${READY_TIMEOUT_MS} ms${tail ? `: ${tail}` : ''} (log: ${logPath})`)
