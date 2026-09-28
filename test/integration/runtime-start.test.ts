import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { cp, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'openapi-startup-test-'))
const release = join(directory, 'release')
const unrelated = join(directory, 'unrelated')
const dataDir = join(release, 'persistent-data', 'pglite')
let child: ChildProcess | undefined
let output = ''
let port = 0

function environment() {
  const env = { ...process.env, NODE_ENV: 'production' }
  for (const key of Object.keys(env)) {
    if (/^(NUXT_|PLATFORM_|DATABASE_|DB_AUTO_MIGRATE|MIGRATIONS_DIR|NITRO_|PORT$|HOST$)/.test(key)) Reflect.deleteProperty(env, key)
  }
  return env
}

async function stop() {
  const active = child
  child = undefined
  if (!active || active.exitCode !== null || active.signalCode) return
  await new Promise<void>(done => {
    active.once('exit', () => done())
    active.kill('SIGTERM')
  })
}

async function start(cwd: string) {
  output = ''
  child = spawn(process.execPath, [join(release, 'server/start.mjs')], {
    cwd, env: environment(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', chunk => { output = (output + String(chunk)).slice(-8000) })
  child.stderr?.on('data', chunk => { output = (output + String(chunk)).slice(-8000) })
  const until = Date.now() + 25_000
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`Startup exited: ${output.replace(/initial password: [^\n]+/g, 'initial password: [redacted]')}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/ready`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch { /* Wait for initialization. */ }
    await new Promise(done => setTimeout(done, 100))
  }
  throw new Error('Release did not become ready within 25 seconds')
}

beforeAll(async () => {
  await mkdir(unrelated)
  await cp(join(projectRoot, '.output'), release, { recursive: true, dereference: true })
  const server = createServer()
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  port = (server.address() as { port: number }).port
  await new Promise<void>(done => server.close(() => done()))
  await writeFile(join(release, '.env'), [
    `NUXT_AUTH_SECRET=${'a'.repeat(64)}`,
    `NUXT_API_KEY_SECRET=${'b'.repeat(64)}`,
    'DATABASE_URL=', 'NUXT_REDIS_URL=', 'PLATFORM_DATA_DIR=persistent-data',
    'NITRO_HOST=127.0.0.1', `NITRO_PORT=${port}`
  ].join('\n'))
  // Launching from another directory must not load an unrelated environment.
  await writeFile(join(unrelated, '.env'), 'NUXT_AUTH_SECRET=invalid\nPLATFORM_DATA_DIR=wrong-data\n')
}, 30_000)

afterAll(async () => {
  await stop()
  if (!resolve(directory).startsWith(resolve(tmpdir(), 'openapi-startup-test-'))) throw new Error('Unexpected cleanup path')
  await rm(directory, { recursive: true, force: true })
})

describe('standalone runtime commands', () => {
  it('rejects concurrent startup on another port and migration against the running database', async () => {
    await start(unrelated)
    try {
      const probe = createServer()
      await new Promise<void>(done => probe.listen(0, '127.0.0.1', done))
      const alternatePort = (probe.address() as { port: number }).port
      await new Promise<void>(done => probe.close(() => done()))
      for (const script of ['start.mjs', 'index.mjs', 'migrate.mjs']) {
        const result = spawnSync(process.execPath, [join(release, 'server', script)], {
          cwd: unrelated, env: {
            ...environment(), NITRO_PORT: String(alternatePort), NITRO_HOST: '127.0.0.1',
            PLATFORM_DATA_DIR: join(release, 'persistent-data'),
            NUXT_AUTH_SECRET: 'a'.repeat(64), NUXT_API_KEY_SECRET: 'b'.repeat(64)
          },
          windowsHide: true, encoding: 'utf8', timeout: 15_000
        })
        expect(result.status, result.stderr).toBe(1)
        expect(result.stderr).toContain('PGlite data directory is locked')
      }
      const response = await fetch(`http://127.0.0.1:${port}/api/ready`)
      expect(response.status).toBe(200)
    } finally { await stop() }
  }, 45_000)

  it('loads traced database drivers for diagnostics in a standalone release', () => {
    const code = `
      const checks = await import(process.argv[1]);
      for (const [method, scheme] of [['checkPostgres', 'postgres'], ['checkRedis', 'redis']]) {
        try { await checks[method](scheme + '://127.0.0.1:' + process.argv[2] + '/0'); }
        catch (error) {
          if (/MODULE_NOT_FOUND|PACKAGE_PATH_NOT_EXPORTED/.test(error.code || '')) throw error;
          continue;
        }
        throw new Error('Expected an unavailable local port');
      }
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code,
      pathToFileURL(join(release, 'server/runtime-checks.mjs')).href, String(port)], {
      cwd: unrelated, env: environment(), windowsHide: true, encoding: 'utf8', timeout: 15_000
    })
    expect(result.status, result.stderr).toBe(0)
  })

  it('starts from only .env, diagnoses a live process and preserves data across working directories', async () => {
    await start(unrelated)
    const doctor = spawnSync(process.execPath, [join(release, 'server/doctor.mjs'), '--json'], {
      cwd: unrelated, env: environment(), windowsHide: true, encoding: 'utf8', timeout: 15_000
    })
    expect(doctor.status, doctor.stderr).toBe(0)
    const report = JSON.parse(doctor.stdout)
    expect(report.ok).toBe(true)
    expect(report.checks.find((check: { name: string }) => check.name === 'readiness').status).toBe('ok')
    expect(doctor.stdout).not.toContain('a'.repeat(64))
    expect(doctor.stdout).not.toContain('b'.repeat(64))
    await stop()
    const database = new PGlite(dataDir)
    try {
      await database.exec("create table startup_probe (value text); insert into startup_probe values ('persisted')")
    } finally { await database.close() }
    await start(release)
    await stop()
    const restored = new PGlite(dataDir)
    try {
      expect((await restored.query('select value from startup_probe')).rows).toEqual([{ value: 'persisted' }])
    } finally { await restored.close() }
  }, 60_000)
})
