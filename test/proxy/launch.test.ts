import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import http from 'node:http'
import net from 'node:net'
import { execFileSync, spawnSync } from 'node:child_process'
import type { AddressInfo } from 'node:net'
import type { LaunchInfo } from '../../plugin/hooks/lib/types.js'

const LAUNCH = 'plugin/server/launch.mjs'
const cleanups: Array<() => Promise<void>> = []

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], { stdio: 'pipe' })
}, 60_000)

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

function listen(server: net.Server, port = 0): Promise<number> {
  return new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(port, '127.0.0.1', () => res((server.address() as AddressInfo).port))
    cleanups.push(
      () =>
        new Promise<void>((r) => {
          server.close(() => r())
          ;(server as http.Server).closeAllConnections?.()
        }),
    )
  })
}

async function upstream(): Promise<number> {
  const s = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html><head></head><body>hi</body></html>')
  })
  return listen(s)
}

function launch(args: string[]) {
  return spawnSync('node', [LAUNCH, ...args], { encoding: 'utf8', timeout: 15_000 })
}

function track(info: LaunchInfo) {
  cleanups.push(async () => {
    try {
      process.kill(info.pid, 'SIGTERM')
    } catch {}
  })
}

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function get(port: number, path = '/') {
  return new Promise<string>((res, rej) => {
    http.get({ host: '127.0.0.1', port, path }, (r) => {
      let b = ''
      r.on('data', (d) => (b += d))
      r.on('end', () => res(b))
    }).on('error', rej)
  })
}

describe('launch.mjs', () => {
  it('starts the proxy, prints LaunchInfo, proxies HTML with overlay tag, shuts down via API', async () => {
    const target = await upstream()
    const r = launch(['--target', String(target), '--cwd', process.cwd()])
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    const info = JSON.parse(r.stdout.trim()) as LaunchInfo
    track(info)
    expect(info.port).toBeGreaterThanOrEqual(4000)
    expect(info.target).toBe(target)
    expect(typeof info.token).toBe('string')
    expect(alive(info.pid)).toBe(true)

    const html = await get(info.port)
    expect(html).toContain('data-web-inspect')

    await new Promise<void>((res, rej) => {
      const req = http.request(
        { host: '127.0.0.1', port: info.port, path: '/__web-inspect/api/shutdown', method: 'POST', headers: { 'x-web-inspect-token': info.token } },
        (resp) => {
          resp.resume()
          resp.on('end', () => res())
        },
      )
      req.on('error', rej)
      req.end()
    })
    const deadline = Date.now() + 2000
    while (alive(info.pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    expect(alive(info.pid)).toBe(false)
  })

  it('picks the next port when the requested one is occupied', async () => {
    const target = await upstream()
    const blocker = net.createServer()
    let base = 4000
    try {
      await listen(blocker, base)
    } catch {
      base = 4100 // 4000 busy on this machine; pick another start port
      await listen(blocker, base)
    }
    const r = launch(['--target', String(target), '--port', String(base)])
    expect(r.status).toBe(0)
    const info = JSON.parse(r.stdout.trim()) as LaunchInfo
    track(info)
    expect(info.port).toBe(base + 1)
  })

  it.each([['abc'], ['0'], ['70000'], ['1.5']])('rejects invalid --target %s', (t) => {
    const r = launch(['--target', t])
    expect(r.status).toBe(1)
    expect(JSON.parse(r.stdout.trim()).error).toMatch(/target/)
  })

  it('rejects missing --target', () => {
    const r = launch([])
    expect(r.status).toBe(1)
    expect(JSON.parse(r.stdout.trim()).error).toBeTruthy()
  })
})
