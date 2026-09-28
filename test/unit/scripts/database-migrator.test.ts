import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { LockedPGlite } from '../../../scripts/pglite-client.mjs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  handlePostgresNotice,
  resolvePgliteDataDir,
  runDatabaseMigrations
} from '../../../scripts/database-migrator.mjs'

const migrationsDir = resolve(process.cwd(), 'server/db/migrations/postgresql')
const temporaryDirectories: string[] = []

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'openapi-migrator-test-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('database migration runner', () => {
  it('uses the fixed PGlite directory for blank overrides', () => {
    expect(resolvePgliteDataDir()).toBe(resolve('.data/pglite'))
    expect(resolvePgliteDataDir('')).toBe(resolve('.data/pglite'))
    expect(resolvePgliteDataDir('   ')).toBe(resolve('.data/pglite'))
    expect(resolvePgliteDataDir(' custom/pglite ')).toBe('custom/pglite')
  })

  it('keeps generated PostgreSQL identifiers within the 63-byte limit', async () => {
    const journal = JSON.parse(await readFile(join(migrationsDir, 'meta/_journal.json'), 'utf8'))
    const oversizedIdentifiers: string[] = []

    for (const entry of journal.entries) {
      const migration = await readFile(join(migrationsDir, `${entry.tag}.sql`), 'utf8')
      for (const match of migration.matchAll(/"([^"]+)"/g)) {
        const identifier = match[1]
        if (identifier && Buffer.byteLength(identifier, 'utf8') > 63) {
          oversizedIdentifiers.push(identifier)
        }
      }
    }

    expect(oversizedIdentifiers).toEqual([])
  })

  it('suppresses benign PostgreSQL migration notices', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    handlePostgresNotice({ code: '42P06' })
    handlePostgresNotice({ code: '42P07' })

    expect(log).not.toHaveBeenCalled()
  })

  it('keeps identifier truncation notices visible', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const notice = { code: '42622', message: 'identifier will be truncated' }

    handlePostgresNotice(notice)

    expect(log).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(notice)
  })

  it('applies the release migration set idempotently', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const dataDir = await createTemporaryDirectory()

    await runDatabaseMigrations({
      databaseUrl: '',
      migrationsDir,
      pgliteDataDir: dataDir,
      timeZone: 'UTC'
    })
    await runDatabaseMigrations({
      databaseUrl: '',
      migrationsDir,
      pgliteDataDir: dataDir,
      timeZone: 'UTC'
    })

    const journal = JSON.parse(await readFile(join(migrationsDir, 'meta/_journal.json'), 'utf8'))
    const client = new PGlite(dataDir)
    await client.waitReady
    const result = await client.query<{ count: number }>(
      'select count(*)::int as count from drizzle.__drizzle_migrations'
    )
    await client.close()

    expect(result.rows[0]?.count).toBe(journal.entries.length)
  }, 20_000)

  it('creates the finalized baseline schema', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const dataDir = await createTemporaryDirectory()

    await runDatabaseMigrations({
      databaseUrl: '',
      migrationsDir,
      pgliteDataDir: dataDir,
      timeZone: 'UTC'
    })

    const client = new PGlite(dataDir)
    await client.waitReady
    const foreignKeys = await client.query<{ conname: string }>(`
      select conname
      from pg_constraint
      where conrelid = 'upstream_service_connections'::regclass
        and contype = 'f'
    `)

    expect(foreignKeys.rows).toEqual([
      { conname: 'upstream_service_connections_service_fk' }
    ])
    await expect(client.query('select route_name from api_calls limit 0')).resolves.toBeTruthy()
    await expect(client.query('select target_name from api_calls limit 0')).rejects.toThrow()
    await expect(client.query('select published_at from routing_revisions limit 0')).resolves.toBeTruthy()
    await expect(client.query('select status from routing_revisions limit 0')).rejects.toThrow()
    await expect(client.query('select managed_by from api_routes limit 0')).rejects.toThrow()
    const routeConnections = await client.query<{ conname: string }>(`
      select conname from pg_constraint
      where conrelid = 'api_routes'::regclass
        and confrelid = 'upstream_service_connections'::regclass
        and contype = 'f'
    `)
    expect(routeConnections.rows).toEqual([{ conname: 'api_routes_service_connection_fk' }])
    await client.close()
  }, 20_000)

  it('rejects an incomplete configured migration directory', async () => {
    const dataDir = await createTemporaryDirectory()
    const incompleteMigrationsDir = await createTemporaryDirectory()

    await expect(runDatabaseMigrations({
      databaseUrl: '',
      migrationsDir: incompleteMigrationsDir,
      pgliteDataDir: dataDir,
      timeZone: 'UTC'
    })).rejects.toThrow('has no meta/_journal.json')
  })

  it('refuses to migrate a database held by the application', async () => {
    const dataDir = await createTemporaryDirectory()
    const active = new LockedPGlite(dataDir)
    try {
      await active.waitReady
      await expect(runDatabaseMigrations({ databaseUrl: '', migrationsDir, pgliteDataDir: dataDir }))
        .rejects.toMatchObject({ code: 'PGLITE_LOCKED' })
      expect((await active.query('select 1 as value')).rows).toEqual([{ value: 1 }])
    } finally { await active.close() }
  }, 15_000)

  it('rejects changed SQL before applying any later migration', async () => {
    const dataDir = await createTemporaryDirectory()
    const copy = await createTemporaryDirectory()
    await cp(migrationsDir, copy, { recursive: true })
    await runDatabaseMigrations({ databaseUrl: '', migrationsDir: copy, pgliteDataDir: dataDir })
    const journalPath = join(copy, 'meta/_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    const sqlFile = join(copy, `${journal.entries[0].tag}.sql`)
    // Only the isolated fixture is modified, never a repository migration.
    await writeFile(sqlFile, `${await readFile(sqlFile, 'utf8')}\n-- altered historical migration\n`)
    journal.entries.push({ ...journal.entries[0], idx: 1, when: journal.entries[0].when + 1, tag: '0001_probe' })
    await writeFile(journalPath, JSON.stringify(journal))
    await writeFile(join(copy, '0001_probe.sql'), 'CREATE TABLE migration_probe (id integer);')
    await expect(runDatabaseMigrations({ databaseUrl: '', migrationsDir: copy, pgliteDataDir: dataDir }))
      .rejects.toMatchObject({ code: 'MIGRATION_HISTORY_MISMATCH' })
    const client = new PGlite(dataDir)
    try {
      expect((await client.query("select to_regclass('public.migration_probe') as name")).rows).toEqual([{ name: null }])
      expect((await client.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows).toEqual([{ count: 1 }])
    } finally { await client.close() }
  }, 20_000)

  it('applies an appended migration after validating the unchanged history', async () => {
    const dataDir = await createTemporaryDirectory()
    const copy = await createTemporaryDirectory()
    await cp(migrationsDir, copy, { recursive: true })
    await runDatabaseMigrations({ databaseUrl: '', migrationsDir: copy, pgliteDataDir: dataDir })
    const journalPath = join(copy, 'meta/_journal.json')
    const journal = JSON.parse(await readFile(journalPath, 'utf8'))
    journal.entries.push({ ...journal.entries[0], idx: 1, when: journal.entries[0].when + 1, tag: '0001_probe' })
    await writeFile(journalPath, JSON.stringify(journal))
    await writeFile(join(copy, '0001_probe.sql'), 'CREATE TABLE migration_probe (id integer);')
    await runDatabaseMigrations({ databaseUrl: '', migrationsDir: copy, pgliteDataDir: dataDir })
    const client = new PGlite(dataDir)
    try {
      expect((await client.query("select to_regclass('public.migration_probe') as name")).rows).toEqual([{ name: 'migration_probe' }])
    } finally { await client.close() }
  }, 20_000)

  it.each(['LF-to-CRLF', 'CRLF-to-LF'])('accepts checkout line ending conversion: %s', async (direction) => {
    const dataDir = await createTemporaryDirectory()
    const copy = await createTemporaryDirectory()
    await cp(migrationsDir, copy, { recursive: true })
    const journal = JSON.parse(await readFile(join(copy, 'meta/_journal.json'), 'utf8'))
    const file = join(copy, `${journal.entries[0].tag}.sql`)
    const lf = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n')
    const crlf = lf.replace(/\n/g, '\r\n')
    await writeFile(file, direction === 'LF-to-CRLF' ? lf : crlf)
    await runDatabaseMigrations({ databaseUrl: '', migrationsDir: copy, pgliteDataDir: dataDir })
    const converted = direction === 'LF-to-CRLF' ? crlf : lf
    await writeFile(file, converted)
    await runDatabaseMigrations({ databaseUrl: '', migrationsDir: copy, pgliteDataDir: dataDir })
    expect(await readFile(file, 'utf8')).toBe(converted)
    const client = new PGlite(dataDir)
    try {
      expect((await client.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows).toEqual([{ count: 1 }])
    } finally { await client.close() }
  }, 20_000)

  it.each(['different-hash', 'unknown-timestamp', 'duplicate-record'])('rejects incompatible history: %s', async (mode) => {
    const dataDir = await createTemporaryDirectory()
    await runDatabaseMigrations({ databaseUrl: '', migrationsDir, pgliteDataDir: dataDir })
    const client = new PGlite(dataDir)
    try {
      if (mode === 'different-hash') await client.exec("update drizzle.__drizzle_migrations set hash = 'old-baseline'")
      if (mode === 'unknown-timestamp') await client.exec('update drizzle.__drizzle_migrations set created_at = created_at + 1')
      if (mode === 'duplicate-record') await client.exec('insert into drizzle.__drizzle_migrations (hash, created_at) select hash, created_at from drizzle.__drizzle_migrations')
    } finally { await client.close() }
    await expect(runDatabaseMigrations({ databaseUrl: '', migrationsDir, pgliteDataDir: dataDir }))
      .rejects.toMatchObject({ code: 'MIGRATION_HISTORY_MISMATCH' })
  }, 20_000)
})
