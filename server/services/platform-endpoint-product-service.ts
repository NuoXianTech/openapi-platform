import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { ServiceEndpointSummary } from '#shared/types/service-control'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { apiProducts, apiVersions } from '~~/server/db/schema'
import type {
  RouteBinding,
  UpstreamView
} from '~~/server/types/platform-publication'
import { firstRow } from '~~/server/utils/row'

export function endpointDefaultVersion(path: string): string {
  return /^\/(v[0-9]+(?:[._-][A-Za-z0-9]+)?)\//.exec(path)?.[1] ?? 'v1'
}

function endpointGroupName(endpoint: ServiceEndpointSummary): string | null {
  return endpoint.tags.find(tag => tag !== 'System' && tag.trim())?.trim() ?? null
}

function normalizedProductSegment(value: string): string {
  const normalized = value.normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (normalized) return normalized
  return `group-${createHash('sha256').update(value).digest('hex').slice(0, 10)}`
}

function boundedProductSlug(value: string): string {
  if (value.length <= 80) return value
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 8)
  return `${value.slice(0, 71).replace(/-+$/g, '')}-${digest}`
}

export function endpointProductDefinition(input: {
  upstream: Pick<UpstreamView, 'slug'>
  serviceName: string
  endpoint: ServiceEndpointSummary
}) {
  const groupName = endpointGroupName(input.endpoint)
  if (!groupName) {
    return {
      slug: input.upstream.slug,
      name: input.serviceName,
      summary: `由 ${input.serviceName} 提供的接口`
    }
  }
  return {
    slug: boundedProductSlug(
      `${input.upstream.slug}-${normalizedProductSegment(groupName)}`
    ),
    name: groupName,
    summary: `由 ${input.serviceName} 提供的 ${groupName} 接口`
  }
}

export async function ensureEndpointVersion(input: {
  upstream: UpstreamView
  serviceName: string
  endpoint: ServiceEndpointSummary
  existingRoutes: RouteBinding[]
  transaction?: DatabaseTransaction
}): Promise<string> {
  const definition = endpointProductDefinition(input)
  const versionName = endpointDefaultVersion(input.endpoint.path)
  const reusable = input.existingRoutes.find(binding => (
    binding.route.upstreamServiceId === input.upstream.id
    && binding.product.slug === definition.slug
    && binding.version.version === versionName
    && binding.product.lifecycle === 'active'
    && (binding.version.state === 'published'
      || binding.version.state === 'deprecated')
  ))
  if (reusable) return reusable.version.id

  const ensure = async (tx: DatabaseTransaction) => {
    let product = firstRow(await tx.insert(apiProducts).values({
      slug: definition.slug,
      name: definition.name,
      summary: definition.summary,
      visibility: 'public',
      lifecycle: 'active'
    }).onConflictDoNothing({
      target: apiProducts.slug,
      where: sql`${apiProducts.deletedAt} IS NULL`
    }).returning())
    if (!product) {
      product = firstRow(await tx.select().from(apiProducts).where(and(
        eq(apiProducts.slug, definition.slug),
        sql`${apiProducts.deletedAt} IS NULL`
      )).limit(1))
    }
    if (!product) throw new Error('endpoint product could not be created')

    const publishedAt = new Date()
    let version = firstRow(await tx.insert(apiVersions).values({
      productId: product.id,
      version: versionName,
      state: 'published',
      openapiDocumentId: input.upstream.openapiDocumentId,
      publishedAt
    }).onConflictDoNothing({
      target: [apiVersions.productId, apiVersions.version]
    }).returning())
    if (!version) {
      // Refresh the contract reference without overwriting operator-owned
      // metadata or reactivating a deliberately retired group/version.
      version = firstRow(await tx.update(apiVersions).set({
        openapiDocumentId: input.upstream.openapiDocumentId
      }).where(and(
        eq(apiVersions.productId, product.id),
        eq(apiVersions.version, versionName)
      )).returning())
    }
    if (!version) throw new Error('endpoint product version could not be created')
    return version.id
  }
  return input.transaction
    ? ensure(input.transaction)
    : db.transaction(ensure)
}
