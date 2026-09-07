import type { ServiceEndpointSummary } from '#shared/types/service-control'
import type { DatabaseTransaction } from '~~/server/db/client'
import {
  endpointDefaultVersion,
  endpointProductDefinition
} from '~~/server/services/platform-endpoint-product-service'
import {
  endpointUpstreamTemplate,
  routeMatchesEndpoint,
  routeMutationFromBinding
} from '~~/server/services/platform-endpoint-publication-service'
import type {
  HttpMethod,
  RouteBinding,
  UpstreamView
} from '~~/server/types/platform-publication'
import { platformRouteService } from '~~/server/services/platform-route-service'

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

export async function synchronizeEndpointSupportRoutes(input: {
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
