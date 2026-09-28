import { createHash } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import {
  apiProducts,
  apiVersions,
  routingRevisions,
  upstreamServiceConnections,
  upstreamServices
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { platformRouteService } from '~~/server/services/platform-route-service'
import {
  applyPlatformMutation,
  routeMutationFromBinding
} from '~~/server/services/platform-endpoint-publication-service'
import type {
  HttpMethod,
  PublicationStatus,
  RouteBinding,
  RouteMutationInput,
  TargetRuntimeDrift,
  UpstreamView
} from '~~/server/types/platform-publication'
import type { PlatformEndpointPublicationPatch } from '#shared/types/platform'
import { findTargetRuntimeDrift } from '~~/server/utils/target-runtime-drift'
import { getServiceControlView } from '~~/server/services/platform-service-control-context'
import { platformUpstreamService } from '~~/server/services/platform-upstream-service'
import { platformRuntimeService } from '~~/server/services/platform-runtime-service'
import { firstRow } from '~~/server/utils/row'
import type { ServiceEndpointSummary } from '#shared/types/service-control'
import type { RoutingRevisionRoute } from '~~/server/types/routing-revision'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { parseRoutePathPattern } from '~~/server/utils/route-pattern'
import { toRoutingRevisionRoute } from '~~/server/utils/routing-revision-route'

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

function endpointPublicationStatus(
  binding: RouteBinding | null,
  liveRoutes: ReadonlyMap<string, RoutingRevisionRoute>
): PublicationStatus {
  if (!binding) return 'available'
  const live = liveRoutes.get(binding.route.id)
  const desiredActive = binding.route.state === 'active'
  if (
    desiredActive
    && live
    && canonicalJson(toRoutingRevisionRoute(binding)) === canonicalJson(live)
  ) return 'live'
  if (desiredActive) return 'pending'
  if (live) return 'retiring'
  return 'disabled'
}

function endpointShape(path: string): string | null {
  try {
    return parseRoutePathPattern(path).normalizedShape
  } catch {
    return null
  }
}

function upstreamTemplateShape(path: string): string | null {
  try {
    return parseRoutePathPattern(
      path.replace(/\{path\.([A-Za-z][A-Za-z0-9_]*)\}/g, '{$1}')
    ).normalizedShape
  } catch {
    return null
  }
}

function endpointUpstreamTemplate(path: string): string {
  const parsed = parseRoutePathPattern(path)
  return parsed.pathPattern.replace(
    /\{([A-Za-z][A-Za-z0-9_]*)(\+)?\}/g,
    (_value, name: string) => `{path.${name}}`
  )
}

function routeMatchesEndpoint(
  binding: RouteBinding,
  endpoint: ServiceEndpointSummary
): boolean {
  return binding.route.method === endpoint.method
    && endpointShape(endpoint.path) !== null
    && endpointShape(endpoint.path)
    === upstreamTemplateShape(binding.route.upstreamPathTemplate)
}

// Display follows the active snapshot; publication below intentionally prefers desired active Routes.
function endpointRoutePriority(
  binding: RouteBinding,
  liveRoutes: ReadonlyMap<string, RoutingRevisionRoute>
): number {
  const status = endpointPublicationStatus(binding, liveRoutes)
  if (status === 'live') return 0
  if (status === 'pending') return 1
  if (status === 'retiring') return 2
  return 3
}

function endpointDefaultVersion(path: string): string {
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

function endpointProductDefinition(input: {
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

async function ensureEndpointVersion(input: {
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

function supportRouteHosts(bindings: RouteBinding[]): string[] {
  if (bindings.some(binding => binding.route.hosts.length === 0)) return []
  return Array.from(new Set(
    bindings.flatMap(binding => binding.route.hosts)
  )).sort()
}

function endpointBelongsToProduct(input: {
  upstream: Pick<UpstreamView, 'slug'>
  serviceName: string
  endpoint: ServiceEndpointSummary
  productSlug: string
}): boolean {
  return endpointProductDefinition(input).slug === input.productSlug
}

async function synchronizeEndpointSupportRoutes(input: {
  upstream: Pick<UpstreamView, 'id' | 'slug'>
  serviceName: string
  endpoints: ServiceEndpointSummary[]
  transaction?: DatabaseTransaction
}) {
  const routes = (await platformRouteService.list({
    transaction: input.transaction
  })).filter(
    binding => binding.route.upstreamServiceId === input.upstream.id
  )
  const endpoints = input.endpoints.filter(endpoint => !endpoint.system)
  const publicEndpoints = endpoints.filter(endpoint => !endpoint.support)
  const supportEndpoints = endpoints.filter(endpoint => endpoint.support)
  const activePublicRoutes = routes.filter(binding => (
    !binding.route.isSupportRoute
    && binding.route.state === 'active'
    && publicEndpoints.some(endpoint => routeMatchesEndpoint(binding, endpoint))
  ))
  const handledSupportRouteIds = new Set<string>()

  for (const endpoint of supportEndpoints) {
    const productSlug = endpointProductDefinition({
      upstream: input.upstream,
      serviceName: input.serviceName,
      endpoint
    }).slug
    const versionName = endpointDefaultVersion(endpoint.path)
    const groupedPublicRoutes = activePublicRoutes.filter(binding => (
      binding.product.slug === productSlug
      && binding.version.version === versionName
    ))
    const candidates = routes.filter(binding => (
      binding.route.isSupportRoute
      && endpointBelongsToProduct({
        upstream: input.upstream,
        serviceName: input.serviceName,
        endpoint,
        productSlug: binding.product.slug
      })
      && routeMatchesEndpoint(binding, endpoint)
    ))
    for (const candidate of candidates) {
      handledSupportRouteIds.add(candidate.route.id)
    }
    if (groupedPublicRoutes.length === 0) {
      await Promise.all(candidates
        .filter(binding => binding.route.state !== 'disabled')
        .map(binding => platformRouteService.update(
          binding.route.id,
          routeMutationFromBinding(binding, {
            isApiKey: false,
            isStatistics: false,
            creditsCost: 0,
            rateLimitPerSecond: 0,
            rateLimitPerMinute: 0,
            rateLimitPerHour: 0,
            rateLimitPerDay: 0,
            state: 'disabled'
          }),
          {
            transaction: input.transaction
          }
        )))
      continue
    }

    const versionId = groupedPublicRoutes[0]!.route.apiVersionId
    const supportHosts = supportRouteHosts(groupedPublicRoutes)
    // Support identity follows the public Version before considering desired state.
    const selected = candidates.find(binding => (
      binding.route.apiVersionId === versionId
    ))
    ?? candidates.find(binding => binding.route.state === 'active')
    ?? candidates[0]
    await Promise.all(candidates
      .filter(binding => binding.route.id !== selected?.route.id)
      .filter(binding => binding.route.state !== 'disabled')
      .map(binding => platformRouteService.update(
        binding.route.id,
        routeMutationFromBinding(binding, { state: 'disabled' }),
        {
          transaction: input.transaction
        }
      )))

    const name = endpoint.summary
      ?? endpoint.operationId
      ?? `${endpoint.method} ${endpoint.path}`
    if (selected) {
      await platformRouteService.update(
        selected.route.id,
        routeMutationFromBinding(selected, {
          apiVersionId: versionId,
          name,
          hosts: supportHosts,
          method: endpoint.method as HttpMethod,
          pathPattern: endpoint.path,
          upstreamPathTemplate: endpointUpstreamTemplate(endpoint.path),
          isApiKey: false,
          isStatistics: false,
          creditsCost: 0,
          rateLimitPerSecond: 0,
          rateLimitPerMinute: 0,
          rateLimitPerHour: 0,
          rateLimitPerDay: 0,
          state: 'active'
        }),
        {
          transaction: input.transaction
        }
      )
      continue
    }
    const created = await platformRouteService.create({
      apiVersionId: versionId,
      name,
      hosts: supportHosts,
      method: endpoint.method as HttpMethod,
      pathPattern: endpoint.path,
      upstreamServiceId: input.upstream.id,
      upstreamPathTemplate: endpointUpstreamTemplate(endpoint.path),
      isApiKey: false,
      isStatistics: false,
      creditsCost: 0,
      rateLimitPerSecond: 0,
      rateLimitPerMinute: 0,
      rateLimitPerHour: 0,
      rateLimitPerDay: 0,
      timeoutMs: 10_000,
      maxRequestBytes: 1024 * 1024,
      maxResponseBytes: 10 * 1024 * 1024,
      state: 'active'
    }, {
      isSupportRoute: true,
      transaction: input.transaction
    })
    if (created) handledSupportRouteIds.add(created.id)
  }

  await Promise.all(routes
    .filter(binding => (
      binding.route.isSupportRoute
      && !handledSupportRouteIds.has(binding.route.id)
      && binding.route.state !== 'disabled'
    ))
    .map(binding => platformRouteService.update(
      binding.route.id,
      routeMutationFromBinding(binding, { state: 'disabled' }),
      {
        transaction: input.transaction
      }
    )))
}

/** Owns Endpoint identity, catalog projection and desired Route reconciliation.
 * Runtime activation remains in the publication module. */
export const platformEndpointService = {
  synchronizeSupportRoutes: synchronizeEndpointSupportRoutes,
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
      typeof getServiceControlView
    >>>()
    await Promise.all(upstreams.map(async (upstream) => {
      try {
        serviceViews.set(
          upstream.id,
          await getServiceControlView(
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
    const view = await getServiceControlView(
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
    const view = await getServiceControlView(
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
