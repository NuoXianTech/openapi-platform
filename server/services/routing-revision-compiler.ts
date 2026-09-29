import type { ServiceEndpointSummary } from '#shared/types/service-control'
import type { RoutingPublicationScope, RoutingRevisionPayload, RoutingRevisionRoute, RoutingRevisionUpstream } from '~~/server/types/routing-revision'
import { createApplicationError } from '~~/server/errors/application-error'
import { findRoutingRouteConflict } from '~~/server/utils/routing-conflict'
import { isServiceTargetReady } from '~~/server/utils/service-upstream-readiness'
import { toRoutingRevisionRoute } from '~~/server/utils/routing-revision-route'

type RouteSource = Parameters<typeof toRoutingRevisionRoute>[0]

export type RoutingRuntimeConfiguration = Required<Pick<
  RoutingRevisionPayload,
  'schemaVersion' | 'routes' | 'appliedRoutes' | 'upstreams' | 'defaultDomain'
>>

interface RoutingCompilationSource {
  routeRows: readonly (RouteSource & { openapiDocumentId: string | null })[]
  products: readonly Pick<RouteSource['product'], 'id' | 'slug' | 'visibility' | 'lifecycle'>[]
  versions: readonly Pick<RouteSource['version'], 'id' | 'version' | 'state'>[]
  currentUpstreams: readonly { id: string, status: string, loadBalancing: string }[]
  contracts: readonly { id: string, endpoints: readonly ServiceEndpointSummary[] }[]
  targetRows: readonly (Parameters<typeof isServiceTargetReady>[0] & {
    id: string, upstreamServiceId: string, baseUrl: string, weight: number
  })[]
  connectionRows: readonly (NonNullable<Parameters<typeof isServiceTargetReady>[1]> & { upstreamServiceId: string })[]
}

export function validatePublishedRouteConflicts(
  routes: RoutingRevisionRoute[],
  defaultDomain: string | null
) {
  const conflict = findRoutingRouteConflict(routes, defaultDomain)
  if (conflict) {
    throw createApplicationError({
      statusCode: 409,
      message: 'routing revision contains conflicting host, method, and path shapes',
      data: { code: 'REVISION_ROUTE_CONFLICT', ...conflict }
    })
  }
}


/** Compile one complete immutable runtime configuration. Inputs must be read
 * under the publication lock; this module never reads or writes the database. */
export function compileRoutingRevision(
  source: RoutingCompilationSource,
  previousRevision: RoutingRevisionPayload | null,
  scope: RoutingPublicationScope,
  defaultDomain: string | null
): RoutingRuntimeConfiguration {
  const { routeRows, products, versions, currentUpstreams, contracts, targetRows, connectionRows } = source
  const activeUpstreams = new Map(
    previousRevision?.upstreams.map(upstream => [upstream.id, upstream])
    ?? []
  )

  const desired = routeRows.filter(row => row.route.state === 'active').map(toRoutingRevisionRoute)
  const previous = previousRevision?.appliedRoutes ?? previousRevision?.routes ?? []
  const previousIds = new Set(previous.map(route => route.id))
  const selectedIds = new Set(scope.kind === 'routes' ? scope.routeIds : [])
  const selected = scope.kind === 'all' ? desired : [
    ...previous.filter(route => !selectedIds.has(route.id)),
    ...desired.filter(route => selectedIds.has(route.id))
  ]
  const currentRoutes = new Map(routeRows.map(row => [row.route.id, row]))
  // Preserve applied Route-owned fields even if their desired rows have
  // pending edits. Product/Version governance is managed independently.
  const productById = new Map(products.map(product => [product.id, product]))
  const versionById = new Map(versions.map(version => [version.id, version]))
  const upstreamById = new Map(currentUpstreams.map(upstream => [upstream.id, upstream]))
  const publicRoutes = selected.filter(route => !route.isSupportRoute && currentRoutes.has(route.id) && upstreamById.has(route.upstreamServiceId))
  const contractById = new Map(contracts.map(contract => [contract.id, contract.endpoints]))
  // Support Routes follow applied public Routes and the discovered contract,
  // not a pending enable/disable in the Endpoint draft.
  const supportCandidates = routeRows.filter(row => {
    if (!row.route.isSupportRoute) return false
    const contract = row.openapiDocumentId ? contractById.get(row.openapiDocumentId) : undefined
    const exists = contract
      ? contract.some(endpoint => endpoint.support && endpoint.method === row.route.method && endpoint.path === row.route.pathPattern)
      : selected.some(route => route.id === row.route.id)
    return exists && publicRoutes.some(route => route.versionId === row.route.apiVersionId && route.upstreamServiceId === row.route.upstreamServiceId)
  }).sort((left, right) => (
    Number(right.route.state === 'active') - Number(left.route.state === 'active')
    || Number(previousIds.has(right.route.id)) - Number(previousIds.has(left.route.id))
    || left.route.id.localeCompare(right.route.id)
  ))
  const supportKeys = new Set<string>()
  const supportRoutes = supportCandidates.filter(({ route }) => {
    const key = JSON.stringify([route.apiVersionId, route.upstreamServiceId, route.method, route.pathPattern])
    if (supportKeys.has(key)) return false
    supportKeys.add(key)
    return true
  }).map(row => {
    const peers = publicRoutes.filter(route => route.versionId === row.route.apiVersionId && route.upstreamServiceId === row.route.upstreamServiceId)
    return { ...toRoutingRevisionRoute(row), hosts: peers.some(route => route.hosts.length === 0)
      ? [] : [...new Set(peers.flatMap(route => route.hosts))].sort() }
  })
  const appliedRoutes = [...publicRoutes, ...supportRoutes].flatMap(route => {
    const product = productById.get(route.productId)
    const version = versionById.get(route.versionId)
    if (!product || !version) return []
    return [{ ...route, productSlug: product.slug,
      productVisibility: product.visibility as RoutingRevisionRoute['productVisibility'],
      productLifecycle: product.lifecycle as RoutingRevisionRoute['productLifecycle'],
      version: version.version, versionState: version.state as RoutingRevisionRoute['versionState'] }]
  }).sort((left, right) => left.id.localeCompare(right.id))
  const eligibleRoutes = appliedRoutes.filter(route => {
    return upstreamById.get(route.upstreamServiceId)?.status === 'active'
      && ['active', 'deprecated'].includes(route.productLifecycle)
      && ['published', 'deprecated'].includes(route.versionState)
  })
  const upstreamDefinitions = new Map(eligibleRoutes.map(route => [route.upstreamServiceId, {
    id: route.upstreamServiceId,
    loadBalancing: upstreamById.get(route.upstreamServiceId)!.loadBalancing as RoutingRevisionUpstream['loadBalancing']
  }]))
  const upstreamIds = Array.from(upstreamDefinitions.keys()).sort()
  const connections = new Map(connectionRows.map(connection => [
    connection.upstreamServiceId,
    connection
  ]))

  // While discovery or reconfiguration is pending, retain verified,
  // enabled Targets from the active snapshot. Other Services can still
  // publish; a new Service without any verified Target stays unpublished.
  const skippedUpstreamIds = new Set<string>()
  const enabledTargets = targetRows.filter(target => target.enabled)
  const upstreams: RoutingRevisionUpstream[] = upstreamIds.flatMap((id) => {
    const definition = upstreamDefinitions.get(id)!
    let targets = enabledTargets
      .filter(target => target.upstreamServiceId === id)
      .filter(target => isServiceTargetReady(target, connections.get(id) ?? null))
      .map(target => ({ id: target.id, baseUrl: target.baseUrl, weight: target.weight }))
      .sort((left, right) => left.id.localeCompare(right.id))
    if (targets.length === 0) {
      const activeUpstream = activeUpstreams.get(id)
      if (activeUpstream) {
        // Keep the last active runtime while a managed Upstream waits
        // for a verified Target. Only retain Targets that still exist
        // and remain enabled; an intentional disable/delete must take
        // effect even while another Target is waiting for verification.
        const enabledTargetIds = new Set(
          enabledTargets
            .filter(target => target.upstreamServiceId === id)
            .map(target => target.id)
        )
        targets = activeUpstream.targets
          .filter(target => enabledTargetIds.has(target.id))
          .map(target => ({ ...target }))
      }
    }
    if (targets.length === 0) {
      skippedUpstreamIds.add(id)
      return []
    }
    return [{ ...definition, targets }]
  })

  const routes = eligibleRoutes
    .filter(route => !skippedUpstreamIds.has(route.upstreamServiceId))
    .sort((left, right) => (
      left.pathPattern.localeCompare(right.pathPattern)
      || left.method.localeCompare(right.method)
      || left.id.localeCompare(right.id)
    ))

  validatePublishedRouteConflicts(routes, defaultDomain)

  return {
    schemaVersion: 1,
    routes,
    appliedRoutes,
    upstreams,
    defaultDomain: defaultDomain
  }
}
