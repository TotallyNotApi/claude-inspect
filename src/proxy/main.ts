// Proxy CLI entry. Usage:
//   node proxy.mjs --target <port> [--port <port>] [--cwd <dir>] --ready-file <path>
// DEP0060 (util._extend, used by http-proxy@1.x) is silenced below via
// process.noDeprecation; static imports are hoisted, but the warning is emitted
// lazily on first proxied request, after this flag is set.
process.noDeprecation = true

import { randomBytes } from 'node:crypto'
import { renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import type { LaunchInfo } from '../../plugin/hooks/lib/types.js'
import { createApi, createWatchdog } from './api.js'
import { createProxyServer } from './server.js'
import { InstructionStore } from './store.js'

const MAX_PORT_TRIES = 20

function listen(server: import('node:http').Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(e)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      resolve()
    })
  })
}

async function listenFree(server: import('node:http').Server, start: number): Promise<number> {
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const port = start + i
    try {
      await listen(server, port)
      return port
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e
    }
  }
  throw new Error(`no free port in ${start}-${start + MAX_PORT_TRIES - 1}`)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      port: { type: 'string', default: '4000' },
      cwd: { type: 'string', default: process.cwd() },
      'ready-file': { type: 'string' },
    },
  })
  const target = Number(values.target)
  const startPort = Number(values.port)
  const readyFile = values['ready-file']
  if (!Number.isInteger(target) || target <= 0 || !Number.isInteger(startPort) || !readyFile) {
    console.error('usage: proxy --target <port> [--port <port>] [--cwd <dir>] --ready-file <path>')
    process.exit(2)
  }
  // Stored for the source resolver (Task 9).
  const cwd = values.cwd as string
  void cwd

  const token = randomBytes(32).toString('hex')
  const store = new InstructionStore()
  const here = dirname(fileURLToPath(import.meta.url))
  const overlayJsPath = join(here, 'overlay.js') // build output sits next to proxy.mjs

  let server: import('node:http').Server
  const shutdown = () => {
    watchdog.stop()
    server.closeAllConnections()
    server.close()
    process.exit(0)
  }
  const watchdog = createWatchdog({ onTimeout: shutdown })
  const handleOwn = createApi(store, {
    token,
    overlayJsPath,
    onShutdown: shutdown,
    onHeartbeat: () => watchdog.heartbeat(),
  })
  server = createProxyServer({
    target,
    overlayTag: `<script src="/__web-inspect/overlay.js?token=${token}" defer data-web-inspect></script>`,
    handleOwn,
  })

  const port = await listenFree(server, startPort)
  const info: LaunchInfo = { port, token, pid: process.pid, target }
  // Atomic: the launcher polls this file, so it must never see a partial write.
  writeFileSync(`${readyFile}.tmp`, JSON.stringify(info))
  renameSync(`${readyFile}.tmp`, readyFile)
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
