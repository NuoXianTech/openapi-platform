import { randomUUID } from 'node:crypto'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'

/** Fresh routing identities isolate health and rotation without production reset hooks. */
export function createGatewayMatch(): ResolvedDynamicRoute {
  const upstreamId = randomUUID()
  return {
    revisionId: randomUUID(),
    params: {},
    route: {
      id: randomUUID(),
      productId: randomUUID(),
      productSlug: 'stream',
      productVisibility: 'public',
      productLifecycle: 'active',
      versionId: randomUUID(),
      version: 'v1',
      versionState: 'published',
      name: 'Stream',
      hosts: [],
      method: 'GET',
      pathPattern: '/v1/stream',
      normalizedShape: '/v1/stream',
      upstreamServiceId: upstreamId,
      upstreamPathTemplate: '/v1/stream',
      isApiKey: true,
      isStatistics: true,
      creditsCost: 2,
      rateLimitPerSecond: 0,
      rateLimitPerMinute: 0,
      rateLimitPerHour: 0,
      rateLimitPerDay: 0,
      timeoutMs: 5_000,
      maxRequestBytes: 0,
      maxResponseBytes: 1024,
      catalogStatus: 'automatic',
      sensitiveQueryParameters: [],
      isSupportRoute: false
    },
    upstream: {
      id: upstreamId,
      loadBalancing: 'round_robin',
      targets: [{ id: randomUUID(), baseUrl: 'http://127.0.0.1:8080', weight: 1 }]
    }
  }
}
