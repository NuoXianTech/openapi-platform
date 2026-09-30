import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import * as schema from '~~/server/db/schema'

/** Exercise production constraints without opening the application's database. */
export async function createTestDatabase() {
  const client = new PGlite()
  const database = drizzle(client, { schema })
  try {
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL('../../server/db/migrations/postgresql', import.meta.url)),
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations'
    })
    return { client, database }
  } catch (error) {
    await client.close()
    throw error
  }
}
