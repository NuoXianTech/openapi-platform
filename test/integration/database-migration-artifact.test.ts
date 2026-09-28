import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, describe, expect, it } from 'vitest'

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const testWorkingDirectory = await mkdtemp(join(tmpdir(), 'openapi-artifact-migration-workspace-'))
const deploymentPackagePath = resolve(projectRoot, '.output/package.json')
const artifactRunner = resolve(projectRoot, '.output/server/migrate.mjs')
const migrationsDir = resolve(projectRoot, '.output/server/db/migrations/postgresql')
const pgliteDataDir = join(testWorkingDirectory, '.data', 'pglite')
const envFile = join(testWorkingDirectory, '.env')
await writeFile(envFile, 'DATABASE_URL=\n')
let migrationProcess: ChildProcess | undefined

afterAll(async () => {
  if (migrationProcess && migrationProcess.exitCode === null && migrationProcess.signalCode === null) {
    const active = migrationProcess
    await new Promise<void>(done => {
      active.once('exit', () => done())
      active.kill('SIGTERM')
    })
  }
  if (!resolve(testWorkingDirectory).startsWith(resolve(tmpdir(), 'openapi-artifact-migration-workspace-'))) throw new Error('Unexpected cleanup path')
  await rm(testWorkingDirectory, { recursive: true, force: true })
})

function runArtifactMigration() {
  return new Promise<{ stderr: string, stdout: string }>((resolveProcess, reject) => {
    const child = spawn(process.execPath, [artifactRunner], {
      cwd: testWorkingDirectory,
      env: {
        ...process.env,
        DATABASE_URL: '',
        PLATFORM_ENV_FILE: envFile,
        PLATFORM_DATA_DIR: join(testWorkingDirectory, '.data'),
        MIGRATIONS_DIR: '',
        NODE_ENV: 'production',
        TZ: 'UTC'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    migrationProcess = child

    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', chunk => (stderr += chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      migrationProcess = undefined
      if (code === 0 && signal === null) {
        resolveProcess({ stderr, stdout })
        return
      }
      reject(new Error(`Artifact migration exited with code ${code} and signal ${signal}.\n${stdout}\n${stderr}`))
    })
  })
}

describe('built deployment artifact', () => {
  it('ships a minimal Node package manifest', async () => {
    const [sourcePackageJson, deploymentPackageJson] = await Promise.all([
      readFile(resolve(projectRoot, 'package.json'), 'utf8'),
      readFile(deploymentPackagePath, 'utf8')
    ])
    const sourcePackage = JSON.parse(sourcePackageJson)
    const deploymentPackage = JSON.parse(deploymentPackageJson)

    expect(deploymentPackage).toEqual({
      name: sourcePackage.name,
      version: sourcePackage.version,
      private: true,
      type: 'module',
      engines: { node: '>=24 <25' },
      scripts: {
        start: 'node server/start.mjs',
        migrate: 'node server/migrate.mjs',
        doctor: 'node server/doctor.mjs'
      }
    })
  })

  it('ships and applies the exact migration set from .output', async () => {
    await Promise.all([
      access(artifactRunner),
      access(resolve(projectRoot, '.output/server/start.mjs')),
      access(resolve(projectRoot, '.output/server/doctor.mjs')),
      access(resolve(projectRoot, '.output/server/pglite-client.mjs')),
      access(resolve(projectRoot, '.output/server/runtime-config.mjs')),
      access(resolve(projectRoot, '.output/server/runtime-checks.mjs')),
      access(resolve(process.cwd(), '.output/server/database-migrator.mjs')),
      access(resolve(migrationsDir, 'meta/_journal.json'))
    ])

    const { stdout } = await runArtifactMigration()
    expect(stdout).toContain('[db:migrate] Database is current through')

    const journal = JSON.parse(await readFile(resolve(migrationsDir, 'meta/_journal.json'), 'utf8'))
    const client = new PGlite(pgliteDataDir)
    try {
      await client.waitReady
      const result = await client.query<{ count: number }>(
        'select count(*)::int as count from drizzle.__drizzle_migrations'
      )
      expect(result.rows[0]?.count).toBe(journal.entries.length)
    } finally { await client.close() }
  }, 30_000)
})
