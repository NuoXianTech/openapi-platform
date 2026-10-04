import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  for (const directory of temporaryDirectories.splice(0)) {
    if (!resolve(directory).startsWith(resolve(tmpdir(), 'openapi-migrator-test-'))) throw new Error('Unexpected cleanup path')
    await rm(directory, { recursive: true, force: true })
  }
})

describe('database migration runner on disk', () => {
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
        if (identifier && Buffer.byteLength(identifier, 'utf8') > 63) oversizedIdentifiers.push(identifier)
      }
    }
    expect(oversizedIdentifiers).toEqual([])
  })

  it('suppresses duplicate-object notices while keeping truncation notices visible', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    handlePostgresNotice({ code: '42P06' })
    handlePostgresNotice({ code: '42P07' })
    expect(log).not.toHaveBeenCalled()
    const notice = { code: '42622', message: 'identifier will be truncated' }
    handlePostgresNotice(notice)
    expect(log).toHaveBeenCalledExactlyOnceWith(notice)
  })

  it('persists the release schema, reruns idempotently and protects a live database', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const dataDir = await createTemporaryDirectory()
    const options = { databaseUrl: '', migrationsDir, pgliteDataDir: dataDir, timeZone: 'UTC' }
    await runDatabaseMigrations(options)
    await runDatabaseMigrations(options)

    const journal = JSON.parse(await readFile(join(migrationsDir, 'meta/_journal.json'), 'utf8'))
    const client = new LockedPGlite(dataDir)
    try {
      await client.waitReady
      await expect(runDatabaseMigrations(options)).rejects.toMatchObject({ code: 'PGLITE_LOCKED' })
      expect((await client.query('select count(*)::int as count from drizzle.__drizzle_migrations')).rows)
        .toEqual([{ count: journal.entries.length }])
      expect((await client.query(`
        select conname from pg_constraint
        where conrelid = 'upstream_service_connections'::regclass and contype = 'f'
      `)).rows).toEqual([{ conname: 'upstream_service_connections_service_fk' }])
      await expect(client.query('select route_name from api_calls limit 0')).resolves.toBeTruthy()
      await expect(client.query('select target_name from api_calls limit 0')).rejects.toThrow()
      await expect(client.query('select published_at from routing_revisions limit 0')).resolves.toBeTruthy()
      await expect(client.query('select status from routing_revisions limit 0')).rejects.toThrow()
      await expect(client.query('select managed_by from api_routes limit 0')).rejects.toThrow()
      expect((await client.query(`
        select conname from pg_constraint
        where conrelid = 'api_routes'::regclass
          and confrelid = 'upstream_service_connections'::regclass and contype = 'f'
      `)).rows).toEqual([{ conname: 'api_routes_service_connection_fk' }])
    } finally {
      await client.close()
    }
  }, 20_000)

  it('rejects an incomplete configured migration directory', async () => {
    const dataDir = await createTemporaryDirectory()
    const incompleteMigrationsDir = await createTemporaryDirectory()
    await expect(runDatabaseMigrations({
      databaseUrl: '', migrationsDir: incompleteMigrationsDir, pgliteDataDir: dataDir, timeZone: 'UTC'
    })).rejects.toThrow('has no meta/_journal.json')
  })
})
