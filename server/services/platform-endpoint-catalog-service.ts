import { eq } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import {
  routingRevisions,
  upstreamServiceConnections,
  upstreamServices
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { platformRouteService } from '~~/server/services/platform-route-service'
import {
  applyPlatformMutation,
  endpointPublicationStatus,
  endpointRoutePriority,
  endpointUpstreamTemplate,
  routeMutationFromBinding,
  routeMatchesEndpoint
} from '~~/server/services/platform-endpoint-publication-service'
import type {
  HttpMethod,
  PublicationStatus,
  RouteBinding,
  RouteMutationInput,
  TargetRuntimeDrift
} from '~~/server/types/platform-publication'
import type { PlatformEndpointPublicationPatch } from '#shared/types/platform'
import { findTargetRuntimeDrift } from '~~/server/utils/target-runtime-drift'
import { ensureEndpointVersion } from '~~/server/services/platform-endpoint-product-service'
import { synchronizeEndpointSupportRoutes } from '~~/server/services/platform-endpoint-support-route-service'
import { platformServiceControlService } from '~~/server/services/platform-service-control-service'
import { platformUpstreamService } from '~~/server/services/platform-upstream-service'
import { platformRuntimeService } from '~~/server/services/platform-runtime-service'
import { firstRow } from '~~/server/utils/row'
import type { ServiceEndpointSummary } from '#shared/types/service-control'

interface CatalogItem {
  key: string
  sourceKind: 'discovered' | 'missing'
  endpoint: ServiceEndpointSummary | null
  route: RouteBinding | null
  status: PublicationStatus
  publishable: boolean
}

async function activeRevision(activeRevisionId: string | null) {
  if (!activeRevisionId) return null
  return firstRow(await db.select().from(routingRevisions)
    .where(eq(routingRevisions.id, activeRevisionId))
    .limit(1)) ?? null
}

async function assertServiceContractCurrent(
  tx: DatabaseTransaction,
  expected: {
    upstreamServiceId: string
    openapiDocumentId: string | null
    openapiSha256: string | null
  }
) {
  const current = firstRow(await tx.select({
    openapiDocumentId: upstreamServices.openapiDocumentId,
    openapiSha256: upstreamServiceConnections.openapiSha256
  }).from(upstreamServices)
    .innerJoin(upstreamServiceConnections, eq(
      upstreamServiceConnections.upstreamServiceId,
      upstreamServices.id
    ))
    .where(eq(upstreamServices.id, expected.upstreamServiceId))
    .limit(1)
    .for('update'))
  if (
    !current
    || current.openapiDocumentId !== expected.openapiDocumentId
    || current.openapiSha256 !== expected.openapiSha256
  ) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service contract changed; refresh the endpoint catalog and retry',
      data: { code: 'SERVICE_CONTRACT_CHANGED' }
    })
  }
}

export const platformEndpointCatalogService = {
  async list() {
    const runtime = await platformRuntimeService.get()
    const [upstreams, routes, revision] = await Promise.all([
      platformUpstreamService.list({ checkAvailability: true }),
      platformRouteService.list(),
      activeRevision(runtime.activeRevisionId)
    ])
    const liveRoutes = new Map(
      (revision?.configPayload.routes ?? []).map(route => [route.id, route])
    )
    const liveUpstreams = new Map(
      (revision?.configPayload.upstreams ?? []).map(upstream => [
        upstream.id,
        upstream
      ])
    )
    const serviceViews = new Map<string, Awaited<ReturnType<
      typeof platformServiceControlService.get
    >>>()
    await Promise.all(upstreams.map(async (upstream) => {
      try {
        serviceViews.set(
          upstream.id,
          await platformServiceControlService.get(
            upstream.id,
            { checkAvailability: false }
          )
        )
      } catch {
        // An incomplete connection remains visible as an undiscovered Service.
      }
    }))

    const services = upstreams.map((upstream) => {
      const serviceRoutes = routes.filter(binding => (
        binding.route.upstreamServiceId === upstream.id
      ))
      const usedRouteIds = new Set<string>()
      const endpoints: CatalogItem[] = (
        serviceViews.get(upstream.id)?.endpoints ?? []
      )
        .filter(endpoint => !endpoint.system)
        .flatMap((endpoint) => {
          const candidates = serviceRoutes
            .filter(binding => (
              !usedRouteIds.has(binding.route.id)
              && routeMatchesEndpoint(binding, endpoint)
            ))
            .sort((left, right) => (
              endpointRoutePriority(left, liveRoutes)
              - endpointRoutePriority(right, liveRoutes)
            ))
          if (endpoint.support) {
            for (const candidate of candidates) {
              usedRouteIds.add(candidate.route.id)
            }
            return []
          }
          const binding = candidates[0] ?? null
          if (binding) usedRouteIds.add(binding.route.id)
          let publishable = true
          try {
            endpointUpstreamTemplate(endpoint.path)
          } catch {
            publishable = false
          }
          return [{
            key: `${upstream.id}:${endpoint.method}:${endpoint.path}:${binding?.route.id ?? 'source'}`,
            sourceKind: 'discovered' as const,
            endpoint,
            route: binding,
            status: endpointPublicationStatus(binding, liveRoutes),
            publishable
          }]
        })

      for (const binding of serviceRoutes) {
        if (usedRouteIds.has(binding.route.id) || binding.route.isSupportRoute) continue
        endpoints.push({
          key: `${upstream.id}:route:${binding.route.id}`,
          sourceKind: 'missing',
          endpoint: null,
          route: binding,
          status: endpointPublicationStatus(binding, liveRoutes),
          publishable: true
        })
      }
      const targetDrift: TargetRuntimeDrift[] = findTargetRuntimeDrift({
        targets: upstream.targets,
        connection: upstream.connection,
        runtimeUpstream: liveUpstreams.get(upstream.id) ?? null
      })
      return { upstream, endpoints, targetDrift }
    })

    const items = services.flatMap(service => service.endpoints)
    return {
      activeRevisionId: revision?.id ?? null,
      activeRevisionSequence: revision?.sequence ?? null,
      services,
      totals: {
        discovered: items.filter(item => item.sourceKind === 'discovered').length,
        live: items.filter(item => item.status === 'live').length,
        available: items.filter(item => item.status === 'available').length,
        pending: items.filter(item => (
          item.status === 'pending' || item.status === 'retiring'
        )).length,
        disabled: items.filter(item => item.status === 'disabled').length,
        driftedTargets: services.reduce(
          (total, service) => total + service.targetDrift.length,
          0
        )
      }
    }
  },

  async publish(input: {
    upstreamServiceId: string
    method: HttpMethod
    path: string
  }, createdBy: number | null, options: { publishRouting?: boolean } = {}) {
    const upstream = await platformUpstreamService.findById(input.upstreamServiceId)
    if (!upstream || upstream.deletedAt) {
      throw createApplicationError({
        statusCode: 404,
        message: 'Service upstream not found',
        data: { code: 'SERVICE_UPSTREAM_NOT_FOUND' }
      })
    }
    if (upstream.status !== 'active') {
      throw createApplicationError({
        statusCode: 409,
        message: 'Service upstream is disabled',
        data: { code: 'UPSTREAM_NOT_ACTIVE' }
      })
    }
    const view = await platformServiceControlService.get(
      upstream.id,
      { checkAvailability: false }
    )
    const endpoint = view.endpoints.find(item => (
      !item.system
      && !item.support
      && item.method === input.method
      && item.path === input.path
    ))
    if (!endpoint) {
      throw createApplicationError({
        statusCode: 404,
        message: 'discovered Service endpoint not found',
        data: { code: 'SERVICE_ENDPOINT_NOT_FOUND' }
      })
    }

    const upstreamView = (await platformUpstreamService.list({
      checkAvailability: false
    }))
      .find(item => item.id === upstream.id)
    if (!upstreamView) throw new Error('upstream view disappeared during publication')
    const committed = await applyPlatformMutation(
      createdBy,
      async (tx) => {
        await assertServiceContractCurrent(tx, {
          upstreamServiceId: upstream.id,
          openapiDocumentId: upstream.openapiDocumentId,
          openapiSha256: view.connection.openapiSha256
        })
        const existingRoutes = await platformRouteService.list({
          transaction: tx
        })
        const existing = existingRoutes
          .filter(binding => (
            binding.route.upstreamServiceId === upstream.id
            && routeMatchesEndpoint(binding, endpoint)
          ))
          .sort((left, right) => (
            Number(right.route.state === 'active')
            - Number(left.route.state === 'active')
          ))[0]
        const apiVersionId = await ensureEndpointVersion({
          upstream: upstreamView,
          serviceName: view.connection.serviceName ?? upstream.name,
          endpoint,
          existingRoutes,
          transaction: tx
        })
        const route = existing
          ? await platformRouteService.update(
              existing.route.id,
              routeMutationFromBinding(existing, {
                apiVersionId,
                state: 'active'
              }),
              { transaction: tx }
            )
          : await platformRouteService.create({
              apiVersionId,
              name: endpoint.summary
                ?? endpoint.operationId
                ?? `${endpoint.method} ${endpoint.path}`,
              hosts: [],
              method: input.method,
              pathPattern: endpoint.path,
              upstreamServiceId: upstream.id,
              upstreamPathTemplate: endpointUpstreamTemplate(endpoint.path),
              isApiKey: false,
              isStatistics: true,
              creditsCost: 0,
              rateLimitPerSecond: 0,
              rateLimitPerMinute: 0,
              rateLimitPerHour: 0,
              rateLimitPerDay: 0,
              timeoutMs: 10_000,
              maxRequestBytes: 1024 * 1024,
              maxResponseBytes: 10 * 1024 * 1024,
              state: 'active'
            }, { transaction: tx })
        if (!route) throw new Error('endpoint route could not be created')
        await synchronizeEndpointSupportRoutes({
          upstream: upstreamView,
          serviceName: view.connection.serviceName ?? upstream.name,
          endpoints: view.endpoints,
          transaction: tx
        })
        return {
          value: { route, created: !existing },
          publishRouting: options.publishRouting !== false
        }
      }
    )
    return {
      ...committed.value,
      revision: committed.revision
    }
  },

  async update(
    routeId: string,
    input: PlatformEndpointPublicationPatch,
    createdBy: number | null,
    options: { publishRouting?: boolean } = {}
  ) {
    const binding = await platformRouteService.get(routeId)
    const view = await platformServiceControlService.get(
      binding.upstream.id,
      { checkAvailability: false }
    )
    const endpoint = view.endpoints.find(item => (
      !item.system && routeMatchesEndpoint(binding, item)
    )) ?? null
    if (binding.route.isSupportRoute || endpoint?.support) {
      throw createApplicationError({
        statusCode: 404,
        message: 'support routes are managed automatically',
        data: { code: 'SUPPORT_ROUTE_NOT_MANAGEABLE' }
      })
    }
    const committed = await applyPlatformMutation(
      createdBy,
      async (tx) => {
        const current = await platformRouteService.get(routeId, {
          transaction: tx
        })
        await assertServiceContractCurrent(tx, {
          upstreamServiceId: binding.upstream.id,
          openapiDocumentId: binding.upstream.openapiDocumentId,
          openapiSha256: view.connection.openapiSha256
        })
        const route = await platformRouteService.update(routeId, {
          apiVersionId: current.route.apiVersionId,
          name: input.name ?? current.route.name,
          hosts: current.route.hosts,
          method: current.route.method as HttpMethod,
          pathPattern: current.route.pathPattern,
          upstreamServiceId: current.route.upstreamServiceId,
          upstreamPathTemplate: current.route.upstreamPathTemplate,
          isApiKey: input.isApiKey ?? current.route.isApiKey,
          isStatistics: input.isStatistics ?? current.route.isStatistics,
          creditsCost: input.creditsCost ?? current.route.creditsCost,
          rateLimitPerSecond: input.rateLimitPerSecond
            ?? current.route.rateLimitPerSecond,
          rateLimitPerMinute: input.rateLimitPerMinute
            ?? current.route.rateLimitPerMinute,
          rateLimitPerHour: input.rateLimitPerHour
            ?? current.route.rateLimitPerHour,
          rateLimitPerDay: input.rateLimitPerDay
            ?? current.route.rateLimitPerDay,
          timeoutMs: input.timeoutMs ?? current.route.timeoutMs,
          maxRequestBytes: input.maxRequestBytes ?? current.route.maxRequestBytes,
          maxResponseBytes: input.maxResponseBytes ?? current.route.maxResponseBytes,
          catalogStatus: input.catalogStatus
            ?? current.route.catalogStatus as RouteMutationInput['catalogStatus'],
          sensitiveQueryParameters: input.sensitiveQueryParameters
            ?? current.route.sensitiveQueryParameters,
          state: input.enabled === undefined
            ? current.route.state as 'draft' | 'active' | 'disabled'
            : input.enabled ? 'active' : 'disabled'
        }, { transaction: tx })
        if (endpoint) {
          await synchronizeEndpointSupportRoutes({
            upstream: current.upstream,
            serviceName: view.connection.serviceName ?? current.upstream.name,
            endpoints: view.endpoints,
            transaction: tx
          })
        }
        return {
          value: route,
          publishRouting: options.publishRouting !== false
        }
      })
    return {
      route: committed.value,
      revision: committed.revision
    }
  }
}
