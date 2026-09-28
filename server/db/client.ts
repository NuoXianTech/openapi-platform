import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import postgres from 'postgres'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { LockedPGlite } from '../../scripts/pglite-client.mjs'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import * as schema from './schema'
import { resolvePgliteDataDir as resolveDataDir } from '../../scripts/runtime-config.mjs'

interface CreatePostgresClientOptions {
  max?: number
}

type PostgresClient = ReturnType<typeof postgres>
type PgliteClient = LockedPGlite
export type DatabaseDriver = 'postgres' | 'pglite'

function handlePostgresNotice(notice: postgres.Notice) {
  if (notice.code === '42P06' || notice.code === '42P07') return
  console.log(notice)
}

function getOptionalDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || undefined
}

export function getDatabaseDriver(): DatabaseDriver {
  return getOptionalDatabaseUrl() ? 'postgres' : 'pglite'
}

function getDatabaseUrl() {
  const databaseUrl = getOptionalDatabaseUrl()

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.')
  }

  return databaseUrl
}

function getDatabasePoolSize() {
  const parsed = Number.parseInt(process.env.DATABASE_POOL_SIZE || '10', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10
}

function createPostgresClient(options: CreatePostgresClientOptions = {}) {
  return postgres(getDatabaseUrl(), {
    max: options.max ?? getDatabasePoolSize(),
    onnotice: handlePostgresNotice
  })
}

export function resolvePgliteDataDir(dataDir?: string): string {
  return resolveDataDir(dataDir)
}

function isFilesystemPgliteDataDir(dataDir: string) {
  return !/^[a-z][a-z0-9+.-]*:\/\//i.test(dataDir)
}

export function ensurePgliteDataDir(dataDir?: string) {
  const resolved = resolvePgliteDataDir(dataDir)
  if (!isFilesystemPgliteDataDir(resolved)) return

  mkdirSync(resolve(resolved), { recursive: true })
}

function createPgliteClient() {
  const dataDir = resolvePgliteDataDir()
  ensurePgliteDataDir(dataDir)
  return new LockedPGlite(dataDir)
}

function createDatabase(client: PostgresClient) {
  return drizzlePostgres(client, { schema })
}

function createPgliteDatabase(client: PgliteClient) {
  return drizzlePglite(client, { schema })
}

export type Database = ReturnType<typeof createDatabase>
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

let sqlClient: PostgresClient | undefined
let pgliteClient: PgliteClient | undefined
let database: Database | undefined

export async function closeDatabase(): Promise<void> {
  const activeSqlClient = sqlClient
  const activePgliteClient = pgliteClient

  sqlClient = undefined
  pgliteClient = undefined
  database = undefined

  await Promise.all([
    activeSqlClient?.end({ timeout: 5 }),
    activePgliteClient?.close()
  ])
}

function getDb() {
  const driver = getDatabaseDriver()

  if (driver === 'postgres' && !sqlClient) {
    sqlClient = createPostgresClient()
  }

  if (driver === 'pglite' && !pgliteClient) {
    pgliteClient = createPgliteClient()
  }

  if (!database) {
    database = driver === 'postgres'
      ? createDatabase(sqlClient!)
      : createPgliteDatabase(pgliteClient!) as unknown as Database
  }

  return database
}

export const db = new Proxy({} as Database, {
  get(_target, property) {
    return Reflect.get(getDb(), property)
  }
})
