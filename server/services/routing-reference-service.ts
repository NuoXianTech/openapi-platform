import { eq } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { platformRuntime, routingRevisions } from '~~/server/db/schema'
import type { RoutingRevisionPayload } from '~~/server/types/routing-revision'

async function activePayload(
  transaction?: DatabaseTransaction
): Promise<RoutingRevisionPayload | null> {
  const executor = transaction ?? db
  const [row] = await executor.select({ payload: routingRevisions.configPayload })
    .from(platformRuntime)
    .innerJoin(routingRevisions, eq(routingRevisions.id, platformRuntime.activeRevisionId))
    .limit(1)
  return row?.payload ?? null
}

export const routingReferenceService = {
  async hasProduct(productId: string, transaction?: DatabaseTransaction): Promise<boolean> {
    const payload = await activePayload(transaction)
    return payload?.routes.some(route => route.productId === productId) ?? false
  },

  async hasVersion(versionId: string, transaction?: DatabaseTransaction): Promise<boolean> {
    const payload = await activePayload(transaction)
    return payload?.routes.some(route => route.versionId === versionId) ?? false
  },

  async hasUpstream(upstreamId: string, transaction?: DatabaseTransaction): Promise<boolean> {
    const payload = await activePayload(transaction)
    return payload?.upstreams.some(upstream => upstream.id === upstreamId) ?? false
  },

  async hasTarget(targetId: string, transaction?: DatabaseTransaction): Promise<boolean> {
    const payload = await activePayload(transaction)
    return payload?.upstreams.some(upstream => (
      upstream.targets.some(target => target.id === targetId)
    )) ?? false
  }
}
