import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import * as schema from '~~/server/db/schema'

/** Create and drop only a database owned by this test run, never the URL's database. */
export async function createPostgresTestDatabase(url: string) {
  const name = `upstream_test_${randomUUID().replaceAll('-', '')}`
  const admin = postgres(url, { max: 1, onnotice: () => {} })
  let created = false
  let client: ReturnType<typeof postgres> | undefined
  try {
    await admin`CREATE DATABASE ${admin(name)}`
    created = true
    const testUrl = new URL(url)
    testUrl.pathname = `/${name}`
    client = postgres(testUrl.toString(), {
      max: 6,
      onnotice: () => {},
      connection: { statement_timeout: 10_000, idle_in_transaction_session_timeout: 15_000 }
    })
    const database = drizzle(client, { schema })
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL('../../server/db/migrations/postgresql', import.meta.url)),
      migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations'
    })
    return {
      database,
      client,
      async close() {
        try {
          await client!.end({ timeout: 5 })
          await admin`DROP DATABASE ${admin(name)}`
        } finally {
          await admin.end({ timeout: 5 })
        }
      }
    }
  } catch (error) {
    try {
      await client?.end({ timeout: 5 })
      if (created) await admin`DROP DATABASE ${admin(name)}`
    } finally {
      await admin.end({ timeout: 5 })
    }
    throw error
  }
}
