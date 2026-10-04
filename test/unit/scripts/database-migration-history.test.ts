import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDatabaseMigrations } from '../../../scripts/database-migrator.mjs'

const context = vi.hoisted(() => ({ client: null as PGlite | null }))
// History validation still runs real Drizzle migrations and PostgreSQL queries.
// Only the disk/connection lifetime is substituted; its contract is covered by
// database-migrator.test.ts and the release-artifact integration suite.
vi.mock('../../../scripts/pglite-client.mjs', () => ({
  LockedPGlite: function MigrationClient() {
    if (!context.client) throw new Error('Migration test database is not ready')
    return context.client
  }
}))

const migrationsDir = resolve('server/db/migrations/postgresql')
let client: PGlite
let fixture: string

beforeAll(async () => {
  client = new PGlite()
  await client.waitReady
  context.client = client
})
beforeEach(async () => {
  await client.exec('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  // The fixture owns the connection across successive calls to the runner.
  vi.spyOn(client, 'close').mockResolvedValue()
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  fixture = await mkdtemp(join(tmpdir(), 'openapi-migration-history-'))
  await cp(migrationsDir, fixture, { recursive: true })
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (!resolve(fixture).startsWith(resolve(tmpdir(), 'openapi-migration-history-'))) throw new Error('Unexpected cleanup path')
  await rm(fixture, { recursive: true, force: true })
})
afterAll(async () => {
  context.client = null
  await client.close()
})

function migrate() {
  return runDatabaseMigrations({ databaseUrl: '', migrationsDir: fixture, pgliteDataDir: 'memory://', timeZone: 'UTC' })
}

async function appendMigration() {
  const journalPath = join(fixture, 'meta/_journal.json')
  const journal = JSON.parse(await readFile(journalPath, 'utf8'))
  journal.entries.push({
    ...journal.entries.at(-1), idx: journal.entries.length,
    when: journal.entries.at(-1).when + 1, tag: '9999_probe'
  })
  await writeFile(journalPath, JSON.stringify(journal))
  await writeFile(join(fixture, '9999_probe.sql'), 'CREATE TABLE migration_probe (id integer);')
}

describe('database migration history', () => {
  it('rejects changed SQL before applying any later migration', async () => {
    await migrate()
    const journal = JSON.parse(await readFile(join(fixture, 'meta/_journal.json'), 'utf8'))
    const sqlFile = join(fixture, `${journal.entries[0].tag}.sql`)
    await writeFile(sqlFile, `${await readFile(sqlFile, 'utf8')}\n-- altered historical migration\n`)
    await appendMigration()
    await expect(migrate()).rejects.toMatchObject({ code: 'MIGRATION_HISTORY_MISMATCH' })
    expect((await client.query("select to_regclass('public.migration_probe') as name")).rows).toEqual([{ name: null }])
    expect((await client.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows)
      .toEqual([{ count: journal.entries.length }])
  })

  it('applies an appended migration after validating the unchanged history', async () => {
    await migrate()
    await appendMigration()
    await migrate()
    expect((await client.query("select to_regclass('public.migration_probe') as name")).rows).toEqual([{ name: 'migration_probe' }])
  })

  it.each(['LF-to-CRLF', 'CRLF-to-LF'])('accepts checkout line ending conversion: %s', async (direction) => {
    const journal = JSON.parse(await readFile(join(fixture, 'meta/_journal.json'), 'utf8'))
    const file = join(fixture, `${journal.entries[0].tag}.sql`)
    const lf = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')
    const crlf = lf.replace(/\n/g, '\r\n')
    await writeFile(file, direction === 'LF-to-CRLF' ? lf : crlf)
    await migrate()
    const converted = direction === 'LF-to-CRLF' ? crlf : lf
    await writeFile(file, converted)
    await migrate()
    expect(await readFile(file, 'utf8')).toBe(converted)
    expect((await client.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows)
      .toEqual([{ count: journal.entries.length }])
  })

  it.each(['different-hash', 'unknown-timestamp', 'duplicate-record'])('rejects incompatible history: %s', async (mode) => {
    await migrate()
    if (mode === 'different-hash') await client.exec("update drizzle.__drizzle_migrations set hash = 'old-baseline'")
    if (mode === 'unknown-timestamp') await client.exec('update drizzle.__drizzle_migrations set created_at = created_at + 1')
    if (mode === 'duplicate-record') await client.exec('insert into drizzle.__drizzle_migrations (hash, created_at) select hash, created_at from drizzle.__drizzle_migrations')
    await expect(migrate()).rejects.toMatchObject({ code: 'MIGRATION_HISTORY_MISMATCH' })
  })
})
