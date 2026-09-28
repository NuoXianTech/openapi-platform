import { cpSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'openapi-cli-test-'))
  directories.push(root)
  cpSync(resolve('scripts'), join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'nuxt.config.ts'), '')
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'openapi-platform' }))
  return root
}
function env(extra: Record<string, string> = {}) {
  const values = { ...process.env }
  for (const key of Object.keys(values)) {
    if (/^(NUXT_|PLATFORM_|DATABASE_|DB_AUTO_MIGRATE|MIGRATIONS_DIR|NITRO_|HOST$|PORT$)/.test(key)) Reflect.deleteProperty(values, key)
  }
  return { ...values, ...extra }
}
function fakeBuild(root: string) {
  mkdirSync(join(root, '.output/server'), { recursive: true })
  writeFileSync(join(root, '.output/server/index.mjs'), 'console.log(JSON.stringify({started:true,entry:process.argv[1],production:process.env.NODE_ENV,data:process.env.PLATFORM_DATA_DIR,overridden:process.env.NUXT_AUTH_SECRET === "process-auth-value-0123456789012345"}))')
}
function configuration(root: string, port: number) {
  writeFileSync(join(root, '.env'), `NUXT_AUTH_SECRET=${'a'.repeat(64)}\nNUXT_API_KEY_SECRET=${'b'.repeat(64)}\nNITRO_PORT=${port}\n`)
}
function run(root: string, extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(root, 'scripts/start.mjs')], {
    cwd: tmpdir(), env: env(extra), encoding: 'utf8', windowsHide: true, timeout: 10_000
  })
}
afterEach(() => {
  for (const root of directories.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir(), 'openapi-cli-test-'))) throw new Error('Unexpected cleanup path')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('startup diagnostics', () => {
  it('explains a missing build before attempting runtime initialization', () => {
    const root = fixture()
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Run pnpm build first')
    expect(existsSync(join(root, '.data'))).toBe(false)
  })

  it('reports both missing secrets without executing the server', () => {
    const root = fixture()
    fakeBuild(root)
    const result = run(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('NUXT_AUTH_SECRET')
    expect(result.stderr).toContain('NUXT_API_KEY_SECRET')
    expect(result.stdout).not.toContain('"started":true')
  })

  it('rejects an occupied port with an actionable error', async () => {
    const root = fixture()
    fakeBuild(root)
    const server = createServer()
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    try {
      configuration(root, (server.address() as { port: number }).port)
      const result = run(root)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('already in use')
      expect(result.stderr).toContain('NITRO_PORT')
      expect(result.stdout).not.toContain('"started":true')
    } finally { await new Promise<void>(done => server.close(() => done())) }
  })

  it('loads source configuration from any working directory with process overrides', async () => {
    const root = fixture()
    fakeBuild(root)
    const server = createServer()
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const port = (server.address() as { port: number }).port
    await new Promise<void>(done => server.close(() => done()))
    configuration(root, port)
    const result = run(root, { NUXT_AUTH_SECRET: 'process-auth-value-0123456789012345' })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout.trim().split('\n').at(-1)!)).toEqual({
      started: true, entry: join(root, '.output/server/index.mjs'), production: 'production', data: join(root, '.data'), overridden: true
    })
  })

  it('reports an invalid PGlite child path in both doctor JSON and startup', () => {
    const root = fixture()
    fakeBuild(root)
    configuration(root, 3000)
    mkdirSync(join(root, '.data'))
    writeFileSync(join(root, '.data/pglite'), 'not a directory')
    const doctor = spawnSync(process.execPath, [join(root, 'scripts/doctor.mjs'), '--json'], {
      cwd: tmpdir(), env: env(), encoding: 'utf8', windowsHide: true, timeout: 10_000
    })
    const databaseCheck = JSON.parse(doctor.stdout).checks.find((check: { name: string }) => check.name === 'database')
    expect(doctor.status).toBe(1)
    expect(databaseCheck.status).toBe('error')
    expect(databaseCheck.message).toContain('not a directory')
    const startup = run(root)
    expect(startup.status).toBe(1)
    expect(startup.stderr).toContain('not a directory')
    expect(startup.stdout).not.toContain('"started":true')
  })
})
