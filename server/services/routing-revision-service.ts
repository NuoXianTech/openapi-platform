import { createHash, randomUUID } from 'node:crypto'
import { and, count, desc, eq, inArray, isNull, max } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import {
  apiProducts,
  apiRoutes,
  apiVersions,
  openapiDocuments,
  platformRuntime,
  routingRevisions,
  upstreamServiceConnections,
  upstreamServices,
  upstreamTargets
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { invalidatePublicApiCatalogCache } from '~~/server/services/api-catalog-service'
import { invalidateRoutingRuntimeCache } from '~~/server/services/routing-runtime-service'
import type {
  RoutingRevisionPayload,
  RoutingPublicationScope
} from '~~/server/types/routing-revision'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { getSqlState } from '~~/server/utils/database-error'
import { firstRow } from '~~/server/utils/row'
import { readStoredServiceEndpoints } from '~~/server/services/platform-service-openapi-service'

import {
  compileRoutingRevision,
  validatePublishedRouteConflicts,
  type RoutingRuntimeConfiguration
} from '~~/server/services/routing-revision-compiler'

function revisionChecksum(payload: RoutingRevisionPayload): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex')
}

function hasSameRuntimeConfiguration(
  current: RoutingRevisionPayload,
  desired: RoutingRuntimeConfiguration
): boolean {
  return canonicalJson({
    schemaVersion: current.schemaVersion,
    routes: current.routes,
    appliedRoutes: current.appliedRoutes ?? [...current.routes].sort((left, right) => left.id.localeCompare(right.id)),
    upstreams: current.upstreams,
    defaultDomain: current.defaultDomain
  }) === canonicalJson(desired)
}

function revisionDefaultDomain(
  payload: RoutingRevisionPayload,
  legacyFallback: string | null
): string | null {
  // Revisions created before defaultDomain became part of schemaVersion 1 do
  // not contain the property. Preserve their historical activation behavior.
  return payload.defaultDomain === undefined ? legacyFallback : payload.defaultDomain
}

/**
 * 发布与激活都要读到同一行运行时并阻塞并发写者，让冲突校验和激活指针串行。
 */
export async function lockPlatformRuntime(tx: DatabaseTransaction) {
  const runtime = firstRow(await tx.select().from(platformRuntime)
    .where(eq(platformRuntime.id, 1))
    .limit(1)
    .for('update'))
  if (!runtime) throw new Error('platform runtime row is missing')
  return runtime
}

export async function invalidateRoutingPublicationCaches(): Promise<void> {
  invalidateRoutingRuntimeCache()
  await invalidatePublicApiCatalogCache()
}

export const routingRevisionService = {
  async list() {
    return db.select().from(routingRevisions).orderBy(desc(routingRevisions.createdAt))
  },

  async listPage(options: { limit: number, offset: number }) {
    const [items, totalRow] = await Promise.all([
      db.select().from(routingRevisions)
        .orderBy(desc(routingRevisions.createdAt))
        .limit(options.limit)
        .offset(options.offset),
      db.select({ value: count() }).from(routingRevisions)
    ])
    return {
      items,
      total: Number(firstRow(totalRow)?.value ?? 0)
    }
  },

  async publish(
    createdBy: number | null,
    options: { tx?: DatabaseTransaction, scope?: RoutingPublicationScope } = {}
  ) {
    try {
      const publish = async (tx: DatabaseTransaction) => {
        // 重新读取运行时单行：同一事务里可能刚改过 defaultDomain，
        // 冲突校验必须看到最新值。已持有锁时这次读取不再阻塞。
        const runtime = await lockPlatformRuntime(tx)

        const routeRows = await tx.select({
          route: apiRoutes,
          product: apiProducts,
          version: apiVersions,
          openapiDocumentId: upstreamServices.openapiDocumentId
        }).from(apiRoutes)
          .innerJoin(apiVersions, eq(apiVersions.id, apiRoutes.apiVersionId))
          .innerJoin(apiProducts, eq(apiProducts.id, apiVersions.productId))
          .innerJoin(upstreamServices, eq(upstreamServices.id, apiRoutes.upstreamServiceId))
          .innerJoin(upstreamServiceConnections, eq(
            upstreamServiceConnections.upstreamServiceId,
            upstreamServices.id
          ))
          .where(and(
            isNull(apiProducts.deletedAt),
            isNull(apiRoutes.deletedAt),
            isNull(upstreamServices.deletedAt)
          ))

        const activeRevision = runtime.activeRevisionId
          ? firstRow(await tx.select().from(routingRevisions)
              .where(eq(routingRevisions.id, runtime.activeRevisionId))
              .limit(1))
          : null
        // Read all compilation inputs under the same runtime lock. Route
        // selection and Target fallback are owned by the compiler.
        const [products, versions, currentUpstreams] = await Promise.all([
          tx.select().from(apiProducts).where(isNull(apiProducts.deletedAt)),
          tx.select().from(apiVersions),
          tx.select().from(upstreamServices).where(isNull(upstreamServices.deletedAt))
        ])
        const documentIds = [...new Set(routeRows.flatMap(row => row.openapiDocumentId ? [row.openapiDocumentId] : []))]
        const upstreamIds = currentUpstreams.map(upstream => upstream.id)
        const [documents, targetRows, connectionRows] = await Promise.all([
          documentIds.length
            ? tx.select().from(openapiDocuments).where(inArray(openapiDocuments.id, documentIds))
            : [],
          upstreamIds.length
            ? tx.select().from(upstreamTargets).where(and(
                inArray(upstreamTargets.upstreamServiceId, upstreamIds),
                eq(upstreamTargets.enabled, true)
              ))
            : [],
          upstreamIds.length
            ? tx.select().from(upstreamServiceConnections).where(inArray(upstreamServiceConnections.upstreamServiceId, upstreamIds))
            : []
        ])
        const desiredConfiguration = compileRoutingRevision({
          routeRows, products, versions, currentUpstreams, targetRows, connectionRows,
          contracts: documents.map(document => ({
            id: document.id,
            endpoints: readStoredServiceEndpoints(document.parsedSummary)
          }))
        }, activeRevision?.configPayload ?? null, options.scope ?? { kind: 'all' }, runtime.defaultDomain)
        if (
          activeRevision
          && hasSameRuntimeConfiguration(
            activeRevision.configPayload,
            desiredConfiguration
          )
        ) return activeRevision

        const sequenceRow = firstRow(await tx.select({ value: max(routingRevisions.sequence) })
          .from(routingRevisions))
        const sequence = Number(sequenceRow?.value ?? 0) + 1
        const revisionId = randomUUID()
        const generatedAt = new Date()
        const payload: RoutingRevisionPayload = {
          ...desiredConfiguration,
          revisionId,
          generatedAt: generatedAt.toISOString()
        }

        const created = firstRow(await tx.insert(routingRevisions).values({
          id: revisionId,
          sequence,
          configPayload: payload,
          checksum: revisionChecksum(payload),
          createdBy,
          publishedAt: generatedAt
        }).returning())
        if (!created) throw new Error('revision insert returned no row')

        await tx.update(platformRuntime)
          .set({ activeRevisionId: created.id, updatedAt: generatedAt })
          .where(eq(platformRuntime.id, 1))

        return created
      }
      const revision = options.tx
        ? await publish(options.tx)
        : await db.transaction(publish)
      if (!options.tx) await invalidateRoutingPublicationCaches()
      return revision
    } catch (error) {
      if (getSqlState(error) === '23505') {
        throw createApplicationError({
          statusCode: 409,
          message: 'routing revision publication conflicted with another publisher; retry the operation',
          data: { code: 'REVISION_PUBLISH_CONFLICT' }
        })
      }
      throw error
    }
  },

  async activate(revisionId: string) {
    const revision = await db.transaction(async (tx) => {
      const runtime = await lockPlatformRuntime(tx)

      const target = firstRow(await tx.select().from(routingRevisions)
        .where(eq(routingRevisions.id, revisionId))
        .limit(1))
      if (!target) {
        throw createApplicationError({ statusCode: 404, message: 'published routing revision not found', data: { code: 'REVISION_NOT_FOUND' } })
      }
      if (runtime.activeRevisionId === target.id) return target

      const defaultDomain = revisionDefaultDomain(target.configPayload, runtime.defaultDomain)
      validatePublishedRouteConflicts(target.configPayload.routes, defaultDomain)
      await tx.update(platformRuntime)
        .set({
          activeRevisionId: target.id,
          defaultDomain,
          updatedAt: new Date()
        })
        .where(eq(platformRuntime.id, 1))
      return target
    })
    await invalidateRoutingPublicationCaches()
    return revision
  }
}
