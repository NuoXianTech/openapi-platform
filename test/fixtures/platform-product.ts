import type { PgliteDatabase } from 'drizzle-orm/pglite'
import * as schema from '~~/server/db/schema'

/** Build isolated routing fixtures without exposing a management creation API. */
export async function createProductFixture(database: PgliteDatabase<typeof schema>, input: {
  slug: string
  name: string
  visibility: 'public' | 'private'
  version: string
}) {
  const [product] = await database.insert(schema.apiProducts).values({
    slug: input.slug,
    name: input.name,
    visibility: input.visibility
  }).returning()
  if (!product) throw new Error('fixture product insert returned no row')
  const [version] = await database.insert(schema.apiVersions).values({
    productId: product.id,
    version: input.version,
    state: 'published',
    publishedAt: new Date()
  }).returning()
  if (!version) throw new Error('fixture version insert returned no row')
  return { ...product, versions: [version] }
}
