import type { ServiceConnectionView } from '#shared/types/service-control'
import type {
  apiProducts,
  apiRoutes,
  apiVersions,
  upstreamServices,
  upstreamTargets
} from '~~/server/db/schema'

export type HttpMethod = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RouteMutationInput {
  apiVersionId: string
  name: string
  hosts: string[]
  method: HttpMethod
  pathPattern: string
  upstreamServiceId: string
  upstreamPathTemplate: string
  isApiKey: boolean
  isStatistics: boolean
  creditsCost: number
  rateLimitPerSecond: number
  rateLimitPerMinute: number
  rateLimitPerHour: number
  rateLimitPerDay: number
  timeoutMs: number
  maxRequestBytes: number
  maxResponseBytes: number
  catalogStatus?: 'automatic' | 'maintenance'
  sensitiveQueryParameters?: string[]
  state: 'draft' | 'active' | 'disabled'
}

export interface RouteBinding {
  route: typeof apiRoutes.$inferSelect
  version: typeof apiVersions.$inferSelect
  product: typeof apiProducts.$inferSelect
  upstream: typeof upstreamServices.$inferSelect
}

export type UpstreamView = typeof upstreamServices.$inferSelect & {
  targets: Array<typeof upstreamTargets.$inferSelect>
  connection: ServiceConnectionView
}

export type PublicationStatus
  = | 'available'
    | 'live'
    | 'pending'
    | 'retiring'
    | 'disabled'

/**
 * A Target only reaches the runtime after discovery verifies it,
 * so the stored address can legitimately differ from the published one. Surfacing
 * the difference keeps a silently stale runtime from looking healthy.
 */
export interface TargetRuntimeDrift {
  targetId: string
  kind: 'address_changed' | 'unpublished' | 'withdrawn'
  runtimeBaseUrl: string | null
  desiredBaseUrl: string | null
}
