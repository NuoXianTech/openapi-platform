import { and, asc, eq, isNull } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import {
  apiProducts,
  apiRoutes,
  apiVersions,
  upstreamServiceConnections,
  upstreamServices
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { getSqlState } from '~~/server/utils/database-error'
import {
  isReservedPlatformPath,
  normalizeRouteHost,
  parseRoutePathPattern,
  validateUpstreamPathTemplate
} from '~~/server/utils/route-pattern'
import { firstRow } from '~~/server/utils/row'
import { routingReferenceService } from '~~/server/services/routing-reference-service'
import type { RouteBinding, RouteMutationInput } from '~~/server/types/platform-publication'

interface RouteMutationOptions {
  isSupportRoute?: boolean
  transaction?: DatabaseTransaction
}

async function normalizeRouteMutation(
  input: RouteMutationInput,
  transaction?: DatabaseTransaction,
  currentUpstreamServiceId?: string
) {
  if (input.creditsCost > 0 && (!input.isApiKey || !input.isStatistics)) {
    throw createApplicationError({
      statusCode: 400,
      message: 'paid routes require API Key authentication and statistics',
      data: { code: 'ROUTE_PAID_POLICY_INVALID' }
    })
  }
  const parsedPath = parseRoutePathPattern(input.pathPattern)
  if (isReservedPlatformPath(parsedPath.pathPattern)) {
    throw createApplicationError({
      statusCode: 400,
      message: 'route path overlaps a reserved Platform path',
      data: { code: 'ROUTE_PATH_RESERVED' }
    })
  }
  const upstreamPathTemplate = validateUpstreamPathTemplate(input.upstreamPathTemplate, parsedPath.parameterNames)
  const hosts = Array.from(new Set(input.hosts.map(normalizeRouteHost))).sort()
  const sensitiveQueryParameters = Array.from(new Set(
    (input.sensitiveQueryParameters ?? [])
      .map(value => value.trim().toLowerCase())
      .filter(Boolean)
  )).sort()

  const executor = transaction ?? db
  const binding = firstRow(await executor.select({
    productLifecycle: apiProducts.lifecycle,
    versionState: apiVersions.state,
    upstreamStatus: upstreamServices.status,
    upstreamDeletedAt: upstreamServices.deletedAt
  }).from(apiVersions)
    .innerJoin(apiProducts, eq(apiProducts.id, apiVersions.productId))
    .innerJoin(upstreamServices, eq(upstreamServices.id, input.upstreamServiceId))
    .innerJoin(upstreamServiceConnections, eq(upstreamServiceConnections.upstreamServiceId, upstreamServices.id))
    .where(and(eq(apiVersions.id, input.apiVersionId), isNull(apiProducts.deletedAt)))
    .limit(1))

  if (!binding) {
    throw createApplicationError({ statusCode: 404, message: 'API version or upstream not found', data: { code: 'ROUTE_BINDING_NOT_FOUND' } })
  }
  if (
    binding.upstreamDeletedAt
    || (
      binding.upstreamStatus !== 'active'
      && input.upstreamServiceId !== currentUpstreamServiceId
    )
  ) {
    throw createApplicationError({ statusCode: 409, message: 'upstream is not active', data: { code: 'UPSTREAM_NOT_ACTIVE' } })
  }

  // When saving an active Route, verify that its parent Product and Version are
  // publishable. This prevents Routes from appearing active in the control plane
  // while being silently excluded from the routing runtime at publication.
  if (input.state === 'active') {
    if (
      binding.productLifecycle !== 'active'
      && binding.productLifecycle !== 'deprecated'
    ) {
      throw createApplicationError({
        statusCode: 409,
        message: `cannot activate a Route when its Product lifecycle is ${binding.productLifecycle}`,
        data: { code: 'PRODUCT_NOT_PUBLISHABLE', productLifecycle: binding.productLifecycle }
      })
    }
    if (
      binding.versionState !== 'published'
      && binding.versionState !== 'deprecated'
    ) {
      throw createApplicationError({
        statusCode: 409,
        message: `cannot activate a Route when its Version state is ${binding.versionState}`,
        data: { code: 'VERSION_NOT_PUBLISHABLE', versionState: binding.versionState }
      })
    }
  }

  return {
    apiVersionId: input.apiVersionId,
    name: input.name,
    hosts,
    method: input.method,
    pathPattern: parsedPath.pathPattern,
    normalizedShape: parsedPath.normalizedShape,
    upstreamServiceId: input.upstreamServiceId,
    upstreamPathTemplate,
    isApiKey: input.isApiKey,
    isStatistics: input.isStatistics,
    creditsCost: input.creditsCost,
    rateLimitPerSecond: input.rateLimitPerSecond,
    rateLimitPerMinute: input.rateLimitPerMinute,
    rateLimitPerHour: input.rateLimitPerHour,
    rateLimitPerDay: input.rateLimitPerDay,
    timeoutMs: input.timeoutMs,
    maxRequestBytes: input.maxRequestBytes,
    maxResponseBytes: input.maxResponseBytes,
    catalogStatus: input.catalogStatus ?? 'automatic',
    sensitiveQueryParameters,
    state: input.state
  }
}

export const platformRouteService = {
  async list(
    options: { transaction?: DatabaseTransaction } = {}
  ): Promise<RouteBinding[]> {
    const executor = options.transaction ?? db
    const rows = await executor.select({
      route: apiRoutes,
      version: apiVersions,
      product: apiProducts,
      upstream: upstreamServices
    }).from(apiRoutes)
      .innerJoin(apiVersions, eq(apiVersions.id, apiRoutes.apiVersionId))
      .innerJoin(apiProducts, eq(apiProducts.id, apiVersions.productId))
      .innerJoin(upstreamServices, eq(upstreamServices.id, apiRoutes.upstreamServiceId))
      .innerJoin(upstreamServiceConnections, eq(
        upstreamServiceConnections.upstreamServiceId,
        upstreamServices.id
      ))
      .where(and(
        isNull(apiRoutes.deletedAt),
        isNull(apiProducts.deletedAt),
        isNull(upstreamServices.deletedAt)
      ))
      .orderBy(asc(apiProducts.name), asc(apiVersions.version), asc(apiRoutes.pathPattern), asc(apiRoutes.method))
    return rows
  },

  async create(input: RouteMutationInput, options: RouteMutationOptions = {}) {
    const executor = options.transaction ?? db
    const values = await normalizeRouteMutation(input, options.transaction)
    try {
      return firstRow(await executor.insert(apiRoutes).values({
        ...values,
        isSupportRoute: options.isSupportRoute ?? false
      }).returning())
    } catch (error) {
      if (getSqlState(error) === '23505') {
        throw createApplicationError({ statusCode: 409, message: 'route conflicts with an existing method and path shape', data: { code: 'ROUTE_CONFLICT' } })
      }
      throw error
    }
  },

  async get(
    id: string,
    options: { transaction?: DatabaseTransaction } = {}
  ): Promise<RouteBinding> {
    const executor = options.transaction ?? db
    const binding = firstRow(await executor.select({
      route: apiRoutes,
      version: apiVersions,
      product: apiProducts,
      upstream: upstreamServices
    }).from(apiRoutes)
      .innerJoin(apiVersions, eq(apiVersions.id, apiRoutes.apiVersionId))
      .innerJoin(apiProducts, eq(apiProducts.id, apiVersions.productId))
      .innerJoin(upstreamServices, eq(upstreamServices.id, apiRoutes.upstreamServiceId))
      .innerJoin(upstreamServiceConnections, eq(
        upstreamServiceConnections.upstreamServiceId,
        upstreamServices.id
      ))
      .where(and(
        eq(apiRoutes.id, id),
        isNull(apiRoutes.deletedAt),
        isNull(apiProducts.deletedAt),
        isNull(upstreamServices.deletedAt)
      ))
      .limit(1))
    if (!binding) {
      throw createApplicationError({
        statusCode: 404,
        message: 'route not found',
        data: { code: 'ROUTE_NOT_FOUND' }
      })
    }
    return binding
  },

  async update(id: string, input: RouteMutationInput, options: RouteMutationOptions = {}) {
    const executor = options.transaction ?? db
    const existing = firstRow(await executor.select().from(apiRoutes)
      .where(and(eq(apiRoutes.id, id), isNull(apiRoutes.deletedAt)))
      .limit(1))
    if (!existing) {
      throw createApplicationError({ statusCode: 404, message: 'route not found', data: { code: 'ROUTE_NOT_FOUND' } })
    }
    const values = await normalizeRouteMutation(
      input,
      options.transaction,
      existing.upstreamServiceId
    )
    try {
      const updated = firstRow(await executor.update(apiRoutes)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(apiRoutes.id, id), isNull(apiRoutes.deletedAt)))
        .returning())
      if (!updated) {
        throw createApplicationError({ statusCode: 404, message: 'route not found', data: { code: 'ROUTE_NOT_FOUND' } })
      }
      return updated
    } catch (error) {
      if (getSqlState(error) === '23505') {
        throw createApplicationError({ statusCode: 409, message: 'route conflicts with an existing method and path shape', data: { code: 'ROUTE_CONFLICT' } })
      }
      throw error
    }
  },

  async remove(id: string, options: RouteMutationOptions = {}) {
    const executor = options.transaction ?? db
    const existing = firstRow(await executor.select().from(apiRoutes)
      .where(and(eq(apiRoutes.id, id), isNull(apiRoutes.deletedAt)))
      .limit(1))
    if (!existing) {
      throw createApplicationError({ statusCode: 404, message: 'route not found', data: { code: 'ROUTE_NOT_FOUND' } })
    }
    if (await routingReferenceService.hasRoute(id, options.transaction)) {
      throw createApplicationError({
        statusCode: 409,
        message: 'disable and publish the route before deleting it',
        data: { code: 'ROUTE_STILL_PUBLISHED' }
      })
    }
    const now = new Date()
    const removed = firstRow(await executor.update(apiRoutes)
      .set({ state: 'disabled', deletedAt: now, updatedAt: now })
      .where(and(eq(apiRoutes.id, id), isNull(apiRoutes.deletedAt)))
      .returning())
    if (!removed) {
      throw createApplicationError({ statusCode: 404, message: 'route not found', data: { code: 'ROUTE_NOT_FOUND' } })
    }
    return removed
  }
}
