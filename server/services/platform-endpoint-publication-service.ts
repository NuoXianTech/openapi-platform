import type { DatabaseTransaction } from '~~/server/db/client'
import { withCommittedTransaction } from '~~/server/utils/committed-transaction'
import {
  invalidateRoutingPublicationCaches,
  lockPlatformRuntime,
  routingRevisionService
} from '~~/server/services/routing-revision-service'
import type {
  HttpMethod,
  RouteBinding,
  RouteMutationInput
} from '~~/server/types/platform-publication'

export interface PlatformPublication {
  revision: { id: string, sequence: number }
}

/** 显式应用全部期望 Route 配置，生成或复用运行快照。 */
export async function applyPlatformRevision(
  createdBy: number | null
): Promise<PlatformPublication> {
  const revision = await routingRevisionService.publish(createdBy)
  return { revision: { id: revision.id, sequence: revision.sequence } }
}

/** Refresh infrastructure/governance without applying pending Endpoint edits. */
export async function refreshPlatformRevision(createdBy: number | null): Promise<PlatformPublication> {
  const revision = await routingRevisionService.publish(createdBy, { scope: { kind: 'applied' } })
  return { revision: { id: revision.id, sequence: revision.sequence } }
}

/**
 * 改动可发布配置后重新发布运行快照。提交与发布在同一事务里，
 * 并通过锁住运行时单行让并发发布串行。
 */
export async function applyPlatformMutation<T>(
  createdBy: number | null,
  mutate: (tx: DatabaseTransaction) => Promise<{
    value: T
    publishRouting?: boolean
    applyRouteIds?: readonly string[]
  }>
) {
  const committed = await withCommittedTransaction(async (tx: DatabaseTransaction) => {
    await lockPlatformRuntime(tx)
    const mutation = await mutate(tx)
    const revision = mutation.publishRouting === false
      ? null
      : await routingRevisionService.publish(createdBy, {
          tx,
          scope: mutation.applyRouteIds
            ? { kind: 'routes', routeIds: mutation.applyRouteIds }
            : { kind: 'applied' }
        })
    return { ...mutation, revision }
  })
  if (committed.publishRouting !== false) {
    await invalidateRoutingPublicationCaches()
  }
  return {
    value: committed.value,
    revision: committed.revision
  }
}

export function routeMutationFromBinding(
  binding: RouteBinding,
  patch: Partial<RouteMutationInput> = {}
): RouteMutationInput {
  return {
    apiVersionId: binding.route.apiVersionId,
    name: binding.route.name,
    hosts: binding.route.hosts,
    method: binding.route.method as HttpMethod,
    pathPattern: binding.route.pathPattern,
    upstreamServiceId: binding.route.upstreamServiceId,
    upstreamPathTemplate: binding.route.upstreamPathTemplate,
    isApiKey: binding.route.isApiKey,
    isStatistics: binding.route.isStatistics,
    creditsCost: binding.route.creditsCost,
    rateLimitPerSecond: binding.route.rateLimitPerSecond,
    rateLimitPerMinute: binding.route.rateLimitPerMinute,
    rateLimitPerHour: binding.route.rateLimitPerHour,
    rateLimitPerDay: binding.route.rateLimitPerDay,
    timeoutMs: binding.route.timeoutMs,
    maxRequestBytes: binding.route.maxRequestBytes,
    maxResponseBytes: binding.route.maxResponseBytes,
    catalogStatus: binding.route.catalogStatus as RouteMutationInput['catalogStatus'],
    sensitiveQueryParameters: binding.route.sensitiveQueryParameters,
    state: binding.route.state as RouteMutationInput['state'],
    ...patch
  }
}
