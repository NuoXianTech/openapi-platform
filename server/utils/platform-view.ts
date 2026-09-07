import type {
  PlatformApiVersion,
  PlatformEndpointCatalog,
  PlatformEndpointPublicationResult,
  PlatformRuntime,
  PlatformProduct,
  PlatformProductSummary,
  PlatformRoute,
  PlatformRouteBinding,
  PlatformRoutingRevision,
  PlatformRoutingRevisionSummary,
  PlatformUpstream,
  PlatformUpstreamSummary,
  PlatformUpstreamTarget
} from '#shared/types/platform'
import type {
  apiProducts,
  apiRoutes,
  apiVersions,
  platformRuntime,
  routingRevisions,
  upstreamServices,
  upstreamTargets
} from '~~/server/db/schema'
import type { UpstreamView } from '~~/server/types/platform-publication'
import { toIsoString, toNullableIsoString } from '~~/server/utils/date'

type RuntimeRow = typeof platformRuntime.$inferSelect
type ProductRow = typeof apiProducts.$inferSelect
type VersionRow = typeof apiVersions.$inferSelect
type UpstreamRow = typeof upstreamServices.$inferSelect
type TargetRow = typeof upstreamTargets.$inferSelect
type RouteRow = typeof apiRoutes.$inferSelect
type RevisionRow = typeof routingRevisions.$inferSelect

export function toPlatformRuntime(row: RuntimeRow): PlatformRuntime {
  return {
    defaultDomain: row.defaultDomain,
    activeRevisionId: row.activeRevisionId,
    updatedAt: toIsoString(row.updatedAt)
  }
}

export function toPlatformApiVersion(row: VersionRow): PlatformApiVersion {
  return {
    id: row.id,
    productId: row.productId,
    version: row.version,
    state: row.state as PlatformApiVersion['state'],
    changelog: row.changelog,
    createdAt: toIsoString(row.createdAt),
    publishedAt: toNullableIsoString(row.publishedAt),
    deprecatedAt: toNullableIsoString(row.deprecatedAt),
    retiredAt: toNullableIsoString(row.retiredAt)
  }
}

export function toPlatformProductSummary(row: ProductRow): PlatformProductSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.summary,
    description: row.description,
    categoryId: row.categoryId,
    visibility: row.visibility as PlatformProductSummary['visibility'],
    lifecycle: row.lifecycle as PlatformProductSummary['lifecycle'],
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  }
}

export function toPlatformProduct(
  row: ProductRow & { versions: VersionRow[] }
): PlatformProduct {
  return {
    ...toPlatformProductSummary(row),
    versions: row.versions.map(toPlatformApiVersion)
  }
}

export function toPlatformUpstreamTarget(row: TargetRow): PlatformUpstreamTarget {
  return {
    id: row.id,
    upstreamServiceId: row.upstreamServiceId,
    baseUrl: row.baseUrl,
    weight: row.weight,
    enabled: row.enabled,
    configurationRevision: row.configurationRevision,
    configurationHash: row.configurationHash,
    configurationStatus: row.configurationStatus as PlatformUpstreamTarget['configurationStatus'],
    lastConfigurationSyncAt: toNullableIsoString(row.lastConfigurationSyncAt),
    lastError: row.lastError,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  }
}

export function toPlatformUpstreamSummary(row: UpstreamRow): PlatformUpstreamSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    loadBalancing: row.loadBalancing as PlatformUpstreamSummary['loadBalancing'],
    status: row.status as PlatformUpstreamSummary['status'],
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  }
}

export function toPlatformUpstream(row: UpstreamView): PlatformUpstream {
  return {
    ...toPlatformUpstreamSummary(row),
    targets: row.targets.map(toPlatformUpstreamTarget),
    connection: row.connection
  }
}

export function toPlatformRoute(row: RouteRow): PlatformRoute {
  return {
    id: row.id,
    apiVersionId: row.apiVersionId,
    name: row.name,
    hosts: row.hosts,
    method: row.method as PlatformRoute['method'],
    pathPattern: row.pathPattern,
    normalizedShape: row.normalizedShape,
    upstreamServiceId: row.upstreamServiceId,
    upstreamPathTemplate: row.upstreamPathTemplate,
    isApiKey: row.isApiKey,
    isStatistics: row.isStatistics,
    creditsCost: row.creditsCost,
    rateLimitPerSecond: row.rateLimitPerSecond,
    rateLimitPerMinute: row.rateLimitPerMinute,
    rateLimitPerHour: row.rateLimitPerHour,
    rateLimitPerDay: row.rateLimitPerDay,
    timeoutMs: row.timeoutMs,
    maxRequestBytes: row.maxRequestBytes,
    maxResponseBytes: row.maxResponseBytes,
    catalogStatus: row.catalogStatus as PlatformRoute['catalogStatus'],
    sensitiveQueryParameters: row.sensitiveQueryParameters,
    isSupportRoute: row.isSupportRoute,
    state: row.state as PlatformRoute['state'],
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  }
}

export function toPlatformRouteBinding(row: {
  route: RouteRow
  version: VersionRow
  product: ProductRow
  upstream: UpstreamRow
}): PlatformRouteBinding {
  return {
    route: toPlatformRoute(row.route),
    version: toPlatformApiVersion(row.version),
    product: toPlatformProductSummary(row.product),
    upstream: toPlatformUpstreamSummary(row.upstream)
  }
}

export function toPlatformRoutingRevision(row: RevisionRow): PlatformRoutingRevision {
  return {
    id: row.id,
    sequence: row.sequence,
    configPayload: row.configPayload,
    checksum: row.checksum,
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    publishedAt: toIsoString(row.publishedAt)
  }
}

export function toPlatformRoutingRevisionSummary(
  row: RevisionRow
): PlatformRoutingRevisionSummary {
  return {
    id: row.id,
    sequence: row.sequence,
    routeCount: row.configPayload.routes.length,
    checksum: row.checksum,
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    publishedAt: toIsoString(row.publishedAt)
  }
}

export function toPlatformEndpointCatalog(
  catalog: Awaited<ReturnType<typeof import('~~/server/services/platform-endpoint-catalog-service').platformEndpointCatalogService.list>>
): PlatformEndpointCatalog {
  return {
    ...catalog,
    services: catalog.services.map(service => ({
      upstream: toPlatformUpstream(service.upstream),
      endpoints: service.endpoints.map(item => ({
        ...item,
        route: item.route ? toPlatformRouteBinding(item.route) : null
      })),
      targetDrift: service.targetDrift
    }))
  }
}

export function toPlatformEndpointPublicationResult(
  result: { route: RouteRow, revision: RevisionRow | null, created?: boolean }
): PlatformEndpointPublicationResult {
  return {
    route: toPlatformRoute(result.route),
    revision: result.revision ? toPlatformRoutingRevision(result.revision) : null,
    ...(result.created === undefined ? {} : { created: result.created })
  }
}
