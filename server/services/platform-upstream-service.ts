import { and, asc, count, eq, inArray, isNull, ne } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { afterCommit, withCommittedTransaction } from '~~/server/utils/committed-transaction'
import {
  upstreamServiceConnections,
  upstreamServices,
  upstreamTargets,
  apiRoutes
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { resolveServiceControlAvailability, toServiceConnectionView } from '~~/server/services/platform-service-control-context'
import { getSqlState } from '~~/server/utils/database-error'
import { firstRow } from '~~/server/utils/row'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'
import { routingReferenceService } from '~~/server/services/routing-reference-service'
import { isServiceTargetReady } from '~~/server/utils/service-upstream-readiness'
import { applyPlatformMutation } from '~~/server/services/routing-revision-service'
import type { UpstreamView } from '~~/server/types/platform-publication'
import { normalizeUpstreamTargetUrl } from '~~/server/utils/upstream-target-url'
import { gatewayTargetHealth } from '~~/server/services/gateway-target-health'

interface CreateUpstreamInput {
  slug: string
  name: string
  loadBalancing: 'round_robin' | 'weighted'
  serviceToken: string
  targets: Array<{
    baseUrl: string
    weight: number
  }>
}

interface UpdateUpstreamInput {
  slug?: string
  name?: string
  loadBalancing?: 'round_robin' | 'weighted'
  status?: 'active' | 'disabled'
}

interface CreateTargetInput {
  baseUrl: string
  weight: number
  enabled: boolean
}

interface UpdateTargetInput {
  baseUrl?: string
  weight?: number
  enabled?: boolean
}

async function findTargetBindingForUpdate(
  tx: DatabaseTransaction,
  id: string
) {
  return firstRow(await tx.select({
    target: upstreamTargets,
    service: upstreamServices
  }).from(upstreamTargets)
    .innerJoin(upstreamServices, eq(upstreamServices.id, upstreamTargets.upstreamServiceId))
    .innerJoin(upstreamServiceConnections, eq(upstreamServiceConnections.upstreamServiceId, upstreamServices.id))
    .where(and(eq(upstreamTargets.id, id), isNull(upstreamServices.deletedAt)))
    .limit(1)
    .for('update'))
}

async function assertCanDisableLastTarget(
  tx: DatabaseTransaction,
  serviceId: string,
  excludingTargetId?: string
): Promise<void> {
  const activeRoutes = firstRow(await tx.select({ value: count() })
    .from(apiRoutes)
    .where(and(
      eq(apiRoutes.upstreamServiceId, serviceId),
      eq(apiRoutes.state, 'active'),
      isNull(apiRoutes.deletedAt)
    )))
  // A pending Route disable does not retire its live traffic. The publication
  // transaction holds the runtime lock while both sources are checked.
  if (Number(activeRoutes?.value ?? 0) === 0
    && !await routingReferenceService.hasUpstream(serviceId, tx)) return

  const enabledTargets = await tx.select()
    .from(upstreamTargets)
    .where(and(
      eq(upstreamTargets.upstreamServiceId, serviceId),
      eq(upstreamTargets.enabled, true),
      excludingTargetId ? ne(upstreamTargets.id, excludingTargetId) : undefined
    ))
  const connection = firstRow(await tx.select()
    .from(upstreamServiceConnections)
    .where(eq(upstreamServiceConnections.upstreamServiceId, serviceId))
    .limit(1)) ?? null
  if (connection && enabledTargets.some(target => isServiceTargetReady(target, connection))) return

  throw createApplicationError({
    statusCode: 409,
    message: 'an active upstream route requires at least one ready target',
    data: { code: 'UPSTREAM_LAST_TARGET_REQUIRED' }
  })
}

async function updateUpstream(tx: DatabaseTransaction, id: string, input: UpdateUpstreamInput) {
  try {
    const updated = firstRow(await tx.update(upstreamServices).set({
      ...input,
      updatedAt: new Date()
    }).where(and(eq(upstreamServices.id, id), isNull(upstreamServices.deletedAt))).returning())
    if (!updated) {
      throw createApplicationError({ statusCode: 404, message: 'upstream not found', data: { code: 'UPSTREAM_NOT_FOUND' } })
    }
    return updated
  } catch (error) {
    if (getSqlState(error) === '23505') {
      throw createApplicationError({ statusCode: 409, message: 'upstream slug already exists', data: { code: 'UPSTREAM_CONFLICT' } })
    }
    throw error
  }
}

async function removeUpstream(tx: DatabaseTransaction, id: string) {
  // Serialize deletion with discovery before cleaning up its Route definitions.
  const row = firstRow(await tx.select({ service: upstreamServices }).from(upstreamServices)
    .innerJoin(upstreamServiceConnections, eq(upstreamServiceConnections.upstreamServiceId, upstreamServices.id))
    .where(eq(upstreamServices.id, id))
    .limit(1)
    .for('update'))
  const service = row?.service
  if (!service || service.deletedAt) {
    throw createApplicationError({ statusCode: 404, message: 'upstream not found', data: { code: 'UPSTREAM_NOT_FOUND' } })
  }
  if (await routingReferenceService.hasUpstream(id, tx)) {
    throw createApplicationError({
      statusCode: 409,
      message: 'upstream is still referenced by an active routing revision',
      data: { code: 'UPSTREAM_STILL_PUBLISHED' }
    })
  }
  const now = new Date()
  // Unapplied and retired Routes, including hidden support Routes, belong to
  // this Upstream. Retain their history without requiring individual deletion.
  await tx.update(apiRoutes).set({
    state: 'disabled',
    deletedAt: now,
    updatedAt: now
  }).where(and(eq(apiRoutes.upstreamServiceId, id), isNull(apiRoutes.deletedAt)))
  const removed = firstRow(await tx.update(upstreamServices).set({
    status: 'disabled',
    deletedAt: now,
    updatedAt: now
  }).where(and(eq(upstreamServices.id, id), isNull(upstreamServices.deletedAt))).returning())
  if (!removed) {
    throw createApplicationError({ statusCode: 404, message: 'upstream not found', data: { code: 'UPSTREAM_NOT_FOUND' } })
  }
  return removed
}

async function createTarget(tx: DatabaseTransaction, upstreamServiceId: string, input: CreateTargetInput) {
  const service = await platformUpstreamService.findById(
    upstreamServiceId,
    { transaction: tx }
  )
  if (!service || service.deletedAt) {
    throw createApplicationError({ statusCode: 404, message: 'upstream not found', data: { code: 'UPSTREAM_NOT_FOUND' } })
  }
  const url = normalizeUpstreamTargetUrl(input.baseUrl)
  try {
    const target = firstRow(await tx.insert(upstreamTargets).values({
      upstreamServiceId,
      baseUrl: url.toString(),
      weight: input.weight,
      enabled: input.enabled
    }).returning())
    if (!target) throw new Error('target insert returned no row')
    return target
  } catch (error) {
    if (getSqlState(error) === '23505') {
      throw createApplicationError({ statusCode: 409, message: 'target URL already exists for this upstream', data: { code: 'TARGET_CONFLICT' } })
    }
    throw error
  }
}

async function updateTarget(tx: DatabaseTransaction, id: string, input: UpdateTargetInput) {
  try {
    const binding = await findTargetBindingForUpdate(tx, id)
    if (!binding) {
      throw createApplicationError({ statusCode: 404, message: 'target not found', data: { code: 'TARGET_NOT_FOUND' } })
    }
    if (binding.target.enabled && input.enabled === false) {
      await assertCanDisableLastTarget(
        tx,
        binding.service.id,
        binding.target.id
      )
    }
    const baseUrl = input.baseUrl === undefined
      ? binding.target.baseUrl
      : normalizeUpstreamTargetUrl(input.baseUrl).toString()
    const resetServiceState = baseUrl !== binding.target.baseUrl
      || (!binding.target.enabled && input.enabled === true)
    const target = firstRow(await tx.update(upstreamTargets).set({
      ...input,
      baseUrl,
      ...(resetServiceState
        ? {
            configurationRevision: null,
            configurationHash: null,
            configurationStatus: 'unknown',
            configurationState: null,
            lastConfigurationSyncAt: null,
            lastError: null
          }
        : {}),
      updatedAt: new Date(Math.max(Date.now(), binding.target.updatedAt.getTime() + 1))
    }).where(eq(upstreamTargets.id, id)).returning())
    if (!target) throw new Error('target update returned no row')
    if (input.baseUrl !== undefined || input.enabled !== undefined) {
      afterCommit(tx, () => gatewayTargetHealth.reset(target.upstreamServiceId, target.id))
    }
    const disablingPublishedTarget = binding.target.enabled
      && target.enabled === false
    const updatingPublishedTarget = !resetServiceState
      && target.enabled
      && input.weight !== undefined
      && input.weight !== binding.target.weight
    return {
      target,
      publishRouting: disablingPublishedTarget
        || updatingPublishedTarget
    }
  } catch (error) {
    if (getSqlState(error) === '23505') {
      throw createApplicationError({ statusCode: 409, message: 'target URL already exists for this upstream', data: { code: 'TARGET_CONFLICT' } })
    }
    throw error
  }
}

// Only the complete mutation calls this step, in the transaction that also
// publishes the removal and invalidates Target health after commit.
async function removeTarget(tx: DatabaseTransaction, id: string) {
  const binding = await findTargetBindingForUpdate(tx, id)
  if (!binding) {
    throw createApplicationError({ statusCode: 404, message: 'target not found', data: { code: 'TARGET_NOT_FOUND' } })
  }
  const published = await routingReferenceService.hasTarget(id, tx)
  if (binding.target.enabled || published) {
    await assertCanDisableLastTarget(
      tx,
      binding.service.id,
      binding.target.id
    )
  }
  await tx.delete(upstreamTargets).where(eq(upstreamTargets.id, id))
  afterCommit(tx, () => gatewayTargetHealth.reset(binding.target.upstreamServiceId, binding.target.id))
  return binding.target
}

export const platformUpstreamService = {
  async list(
    options: { checkAvailability?: boolean, ids?: string[] } = {}
  ): Promise<UpstreamView[]> {
    if (options.ids?.length === 0) return []
    const serviceFilter = options.ids === undefined
      ? isNull(upstreamServices.deletedAt)
      : and(
          isNull(upstreamServices.deletedAt),
          inArray(upstreamServices.id, options.ids)
        )
    const rows = await db.select({
      service: upstreamServices,
      target: upstreamTargets,
      connection: upstreamServiceConnections
    })
      .from(upstreamServices)
      .leftJoin(upstreamTargets, eq(upstreamTargets.upstreamServiceId, upstreamServices.id))
      .innerJoin(upstreamServiceConnections, eq(
        upstreamServiceConnections.upstreamServiceId,
        upstreamServices.id
      ))
      .where(serviceFilter)
      .orderBy(asc(upstreamServices.name), asc(upstreamTargets.createdAt))

    const result = new Map<string, typeof upstreamServices.$inferSelect & {
      targets: Array<typeof upstreamTargets.$inferSelect>
      connectionRecord: typeof upstreamServiceConnections.$inferSelect
    }>()
    for (const row of rows) {
      const item = result.get(row.service.id) ?? {
        ...row.service,
        targets: [],
        connectionRecord: row.connection
      }
      if (row.target) item.targets.push(row.target)
      result.set(row.service.id, item)
    }
    return Promise.all(Array.from(result.values()).map(async (item) => {
      const { connectionRecord, ...upstream } = item
      const availability = options.checkAvailability === true
        ? (await resolveServiceControlAvailability({
            service: upstream, connection: connectionRecord, targets: upstream.targets
          })).overall
        : 'unknown'
      return {
        ...upstream,
        connection: toServiceConnectionView(connectionRecord, availability)
      }
    }))
  },

  async listPage(options: { checkAvailability?: boolean, limit: number, offset: number }) {
    const [rows, totalRow] = await Promise.all([
      db.select({ id: upstreamServices.id })
        .from(upstreamServices)
        .innerJoin(upstreamServiceConnections, eq(upstreamServiceConnections.upstreamServiceId, upstreamServices.id))
        .where(isNull(upstreamServices.deletedAt))
        .orderBy(asc(upstreamServices.name), asc(upstreamServices.id))
        .limit(options.limit)
        .offset(options.offset),
      db.select({ value: count() }).from(upstreamServices)
        .innerJoin(upstreamServiceConnections, eq(upstreamServiceConnections.upstreamServiceId, upstreamServices.id))
        .where(isNull(upstreamServices.deletedAt))
    ])
    const ids = rows.map(row => row.id)
    const items = ids.length === 0
      ? []
      : await platformUpstreamService.list({
          checkAvailability: options.checkAvailability,
          ids
        })
    const order = new Map(ids.map((id, index) => [id, index]))
    items.sort((left, right) => (
      (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
    ))
    return {
      items,
      total: Number(firstRow(totalRow)?.value ?? 0)
    }
  },

  async create(input: CreateUpstreamInput) {
    const normalizedTargets = input.targets.map(target => ({
      ...target,
      url: normalizeUpstreamTargetUrl(target.baseUrl)
    }))
    try {
      return await withCommittedTransaction(async (tx) => {
        const service = firstRow(await tx.insert(upstreamServices).values({
          slug: input.slug,
          name: input.name,
          loadBalancing: input.loadBalancing
        }).returning())
        if (!service) throw new Error('upstream insert returned no row')

        const targets = await tx.insert(upstreamTargets).values(normalizedTargets.map(target => ({
          upstreamServiceId: service.id,
          baseUrl: target.url.toString(),
          weight: target.weight
        }))).returning()
        const connection = await upstreamServiceTokenService.initialize(tx, service.id, input.serviceToken)
        return {
          ...service,
          targets,
          connection: toServiceConnectionView(connection)
        }
      })
    } catch (error) {
      if (getSqlState(error) === '23505') {
        throw createApplicationError({ statusCode: 409, message: 'upstream slug or target already exists', data: { code: 'UPSTREAM_CONFLICT' } })
      }
      throw error
    }
  },

  async findById(
    id: string,
    options: { transaction?: DatabaseTransaction } = {}
  ) {
    const executor = options.transaction ?? db
    const row = firstRow(await executor.select({ service: upstreamServices }).from(upstreamServices)
      .innerJoin(upstreamServiceConnections, eq(upstreamServiceConnections.upstreamServiceId, upstreamServices.id))
      .where(eq(upstreamServices.id, id))
      .limit(1))
    return row?.service
  },

  async updateServiceToken(id: string, serviceToken: string) {
    const connection = await withCommittedTransaction(tx => upstreamServiceTokenService.stage(tx, id, serviceToken))
    return toServiceConnectionView(connection)
  },

  async updateAndPublish(
    id: string,
    input: UpdateUpstreamInput & { serviceToken?: string },
    createdBy: number | null
  ) {
    const { serviceToken, ...patch } = input
    const committed = await applyPlatformMutation(createdBy, async (tx) => {
      const upstream = await updateUpstream(tx, id, patch)
      if (serviceToken !== undefined) await upstreamServiceTokenService.stage(tx, id, serviceToken)
      return { value: upstream, publishRouting: Object.keys(patch).length > 0 }
    })
    const { value: upstream, ...publication } = committed
    return { upstream, ...publication }
  },

  async removeAndPublish(id: string, createdBy: number | null) {
    const committed = await applyPlatformMutation(createdBy, async tx => ({
      value: await removeUpstream(tx, id)
    }))
    const { value: upstream, ...publication } = committed
    return { upstream, ...publication }
  },

  async createTargetAndPublish(
    upstreamServiceId: string,
    input: CreateTargetInput,
    createdBy: number | null
  ) {
    const committed = await applyPlatformMutation(createdBy, async (tx) => {
      const target = await createTarget(tx, upstreamServiceId, input)
      return { value: target, publishRouting: false }
    })
    const { value: target, ...publication } = committed
    return { target, ...publication }
  },

  async updateTargetAndPublish(
    id: string,
    input: UpdateTargetInput,
    createdBy: number | null
  ) {
    const committed = await applyPlatformMutation(createdBy, async (tx) => {
      const updated = await updateTarget(tx, id, input)
      return { value: updated.target, publishRouting: updated.publishRouting }
    })
    const { value: target, ...publication } = committed
    return { target, ...publication }
  },

  async removeTargetAndPublish(id: string, createdBy: number | null) {
    const committed = await applyPlatformMutation(createdBy, async tx => ({
      value: await removeTarget(tx, id)
    }))
    const { value: target, ...publication } = committed
    return { target, ...publication }
  }
}
