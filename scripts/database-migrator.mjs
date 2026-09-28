import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { LockedPGlite } from './pglite-client.mjs'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import { resolvePgliteDataDir } from './runtime-config.mjs'

export { resolvePgliteDataDir }

// Nitro may inline this module and rewrite import.meta.url to file:///_entry.js,
// which is not a valid absolute file URL on Windows. The executable entry and
// working directory are stable for both source and release-artifact layouts.
const runtimeDirectory = process.argv[1]
  ? path.dirname(path.resolve(process.argv[1]))
  : process.cwd()
const migrationsRelativePath = path.join('db', 'migrations', 'postgresql')
const MIGRATION_ADVISORY_LOCK_KEY = 'openapi:database-migrations'
const ignoredPostgresNoticeCodes = new Set([
  '42P06', // duplicate_schema from idempotent migration setup
  '42P07' // duplicate_table from idempotent migration setup
])

/**
 * @typedef {{
 *   databaseUrl?: string,
 *   migrationsDir?: string,
 *   pgliteDataDir?: string,
 *   timeZone?: string
 * }} MigrationOptions
 */

export function handlePostgresNotice(notice) {
  if (ignoredPostgresNoticeCodes.has(notice.code)) return
  console.log(notice)
}

function getSqlState(error) {
  const visited = new Set()
  let current = error

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current)
    const code = 'code' in current ? current.code : undefined
    if (typeof code === 'string') return code
    current = 'cause' in current ? current.cause : undefined
  }

  return undefined
}

function inspectMigrationsFolder(folder) {
  const journalPath = path.join(folder, 'meta', '_journal.json')
  if (!fs.existsSync(journalPath)) return undefined

  let journal
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read migration journal at ${journalPath}.`, { cause: error })
  }

  if (!journal || !Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error(`Migration journal at ${journalPath} contains no migrations.`)
  }

  const tags = new Set()
  const migrations = []
  for (const [position, entry] of journal.entries.entries()) {
    if (!entry || entry.idx !== position || typeof entry.tag !== 'string' || !entry.tag) {
      throw new Error(`Migration journal at ${journalPath} has an invalid entry at index ${position}.`)
    }
    if (tags.has(entry.tag)) {
      throw new Error(`Migration journal at ${journalPath} contains duplicate tag ${entry.tag}.`)
    }
    if (!Number.isSafeInteger(entry.when) || entry.when < 0
      || (position > 0 && entry.when <= journal.entries[position - 1].when)) {
      throw new Error(`Migration journal at ${journalPath} has invalid or unordered timestamps.`)
    }

    const migrationPath = path.join(folder, `${entry.tag}.sql`)
    if (!fs.existsSync(migrationPath) || fs.statSync(migrationPath).size === 0) {
      throw new Error(`Migration file is missing or empty: ${migrationPath}`)
    }
    tags.add(entry.tag)
    const sql = fs.readFileSync(migrationPath, 'utf8')
    const lf = sql.replace(/\r\n/g, '\n')
    migrations.push({
      tag: entry.tag, when: entry.when,
      // Drizzle stores the raw file hash. Git may convert line endings between
      // checkouts, so recognize both forms without rewriting migration files.
      hashes: new Set([sql, lf, lf.replace(/\n/g, '\r\n')].map(content => (
        createHash('sha256').update(content).digest('hex')
      )))
    })
  }

  return {
    path: folder,
    count: journal.entries.length,
    latestTag: journal.entries.at(-1).tag,
    migrations
  }
}

function resolveReleaseVersion() {
  const sourcePackage = path.resolve(process.cwd(), 'package.json')
  const runtimePackages = [
    path.resolve(runtimeDirectory, 'package.json'),
    path.resolve(process.cwd(), 'server/package.json'),
    path.resolve(process.cwd(), '.output/server/package.json')
  ]
  const candidates = [...new Set(path.basename(runtimeDirectory) === 'scripts'
    ? [sourcePackage, ...runtimePackages]
    : [...runtimePackages, sourcePackage])]

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue

    try {
      const packageJson = JSON.parse(fs.readFileSync(candidate, 'utf8'))
      if (typeof packageJson.version === 'string' && packageJson.version) {
        return packageJson.version
      }
    } catch {
      // Migration validation owns hard failures; a missing display version does not block recovery.
    }
  }

  return undefined
}

function resolveMigrationsFolder(configuredDirectory) {
  if (configuredDirectory) {
    const configured = path.resolve(configuredDirectory)
    const migrationSet = inspectMigrationsFolder(configured)
    if (!migrationSet) {
      throw new Error(`Configured migrations folder has no meta/_journal.json: ${configured}`)
    }
    return migrationSet
  }

  const candidates = [...new Set([
    path.resolve(runtimeDirectory, migrationsRelativePath),
    path.resolve(process.cwd(), 'server', migrationsRelativePath),
    path.resolve(process.cwd(), '.output', 'server', migrationsRelativePath)
  ])]

  for (const candidate of candidates) {
    const migrationSet = inspectMigrationsFolder(candidate)
    if (migrationSet) return migrationSet
  }

  throw new Error(`Cannot find bundled database migrations. Tried:\n${candidates.join('\n')}`)
}

function resolveDatabaseConfig(options) {
  const databaseUrl = (options.databaseUrl ?? process.env.DATABASE_URL)?.trim() || undefined
  const driver = databaseUrl ? 'postgres' : 'pglite'

  return {
    databaseUrl,
    driver,
    pgliteDataDir: resolvePgliteDataDir(options.pgliteDataDir),
    timeZone: options.timeZone ?? process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  }
}

function isFilesystemPgliteDataDir(dataDir) {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(dataDir)
}

function ensurePgliteDataDir(dataDir) {
  const resolved = resolvePgliteDataDir(dataDir)
  if (!isFilesystemPgliteDataDir(resolved)) return
  fs.mkdirSync(path.resolve(resolved), { recursive: true })
}

function formatPostgresTarget(databaseUrl) {
  const url = new URL(databaseUrl)
  return `${url.protocol}//${url.host}${url.pathname}`
}

async function ensureDatabaseExists(databaseUrl) {
  const url = new URL(databaseUrl)
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!databaseName) {
    throw new Error('DATABASE_URL must include a database name.')
  }

  const adminUrl = new URL(url)
  adminUrl.pathname = '/postgres'

  const adminClient = postgres(adminUrl.toString(), { max: 1, onnotice: handlePostgresNotice })
  try {
    const rows = await adminClient`
      SELECT 1 FROM pg_database WHERE datname = ${databaseName}
    `
    if (rows.length > 0) return

    try {
      await adminClient`CREATE DATABASE ${adminClient(databaseName)}`
      console.log(`[db:migrate] Created database ${databaseName}`)
    } catch (error) {
      if (getSqlState(error) !== '42P04') throw error
    }
  } finally {
    await adminClient.end()
  }
}

async function verifyMigrationHistory(query, migrationSet) {
  const tables = await query("select to_regclass('drizzle.__drizzle_migrations') as name")
  if (!tables[0]?.name) return
  const rows = await query('select hash, created_at from drizzle.__drizzle_migrations order by created_at, id')
  for (const [index, row] of rows.entries()) {
    const expected = migrationSet.migrations[index]
    if (!expected || Number(row.created_at) !== expected.when || !expected.hashes.has(row.hash)) {
      const error = new Error('Database migration history does not match this release. Check the database target and release version; restore the matching immutable migration files or use a verified data migration. No migrations were applied.')
      error.code = 'MIGRATION_HISTORY_MISMATCH'
      throw error
    }
  }
}

async function migratePostgresOnce(databaseUrl, timeZone, migrationSet) {
  const client = postgres(databaseUrl, { max: 1, onnotice: handlePostgresNotice })
  const database = drizzlePostgres(client)
  let hasMigrationLock = false

  try {
    await client`select set_config('TimeZone', ${timeZone}, false)`
    await client`SELECT pg_advisory_lock(hashtext(${MIGRATION_ADVISORY_LOCK_KEY}))`
    hasMigrationLock = true
    await verifyMigrationHistory(query => client.unsafe(query), migrationSet)
    await migratePostgres(database, {
      migrationsFolder: migrationSet.path,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations'
    })
  } finally {
    if (hasMigrationLock) {
      await client`SELECT pg_advisory_unlock(hashtext(${MIGRATION_ADVISORY_LOCK_KEY}))`.catch((error) => {
        console.error('[db:migrate] Failed to release migration advisory lock.', error)
      })
    }
    await client.end()
  }
}

async function migratePgliteOnce(dataDir, timeZone, migrationSet) {
  ensurePgliteDataDir(dataDir)
  const client = new LockedPGlite(dataDir)

  try {
    await client.waitReady
    await client.query('select set_config($1, $2, false)', ['TimeZone', timeZone])
    await verifyMigrationHistory(async query => (await client.query(query)).rows, migrationSet)
    await migratePglite(drizzlePglite(client), {
      migrationsFolder: migrationSet.path,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations'
    })
  } finally {
    await client.close()
  }
}

/**
 * Applies every pending immutable Drizzle migration from the release artifact.
 * Calling this function repeatedly is safe; Drizzle records applied migrations
 * in drizzle.__drizzle_migrations and skips them on later runs.
 *
 * @param {MigrationOptions} [options]
 * @returns {Promise<void>}
 */
export async function runDatabaseMigrations(options = {}) {
  const migrationSet = resolveMigrationsFolder(options.migrationsDir ?? process.env.MIGRATIONS_DIR)
  const config = resolveDatabaseConfig(options)
  const releaseVersion = resolveReleaseVersion()
  const target = config.driver === 'pglite'
    ? `PGlite ${config.pgliteDataDir}`
    : formatPostgresTarget(config.databaseUrl)

  if (releaseVersion) console.log(`[db:migrate] Release: ${releaseVersion}`)
  console.log(`[db:migrate] Target: ${config.driver} (${target})`)
  console.log(`[db:migrate] Migration set: ${migrationSet.latestTag} (${migrationSet.count} file(s))`)

  if (config.driver === 'pglite') {
    await migratePgliteOnce(config.pgliteDataDir, config.timeZone, migrationSet)
  } else {
    try {
      await migratePostgresOnce(config.databaseUrl, config.timeZone, migrationSet)
    } catch (error) {
      if (getSqlState(error) !== '3D000') throw error

      await ensureDatabaseExists(config.databaseUrl)
      await migratePostgresOnce(config.databaseUrl, config.timeZone, migrationSet)
    }
  }

  console.log(`[db:migrate] Database is current through ${migrationSet.latestTag}.`)
}
