interface RoutingRevisionTarget {
  id: string
  baseUrl: string
  weight: number
}

export interface RoutingRevisionUpstream {
  id: string
  loadBalancing: 'round_robin' | 'weighted'
  targets: RoutingRevisionTarget[]
}

export interface RoutingRevisionRoute {
  id: string
  productId: string
  productSlug: string
  productVisibility: 'public' | 'private'
  productLifecycle: 'active' | 'deprecated' | 'retired'
  versionId: string
  version: string
  versionState: 'draft' | 'published' | 'deprecated' | 'retired'
  name: string
  hosts: string[]
  method: string
  pathPattern: string
  normalizedShape: string
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
  catalogStatus: 'automatic' | 'maintenance'
  sensitiveQueryParameters: string[]
  isSupportRoute: boolean
}

export interface RoutingRevisionPayload {
  schemaVersion: 1
  revisionId: string
  generatedAt: string
  defaultDomain: string | null
  routes: RoutingRevisionRoute[]
  /** Last explicitly applied Route configuration, including temporarily unroutable Routes.
   * Older revisions use their executable routes as this baseline. */
  appliedRoutes?: RoutingRevisionRoute[]
  upstreams: RoutingRevisionUpstream[]
}

export type RoutingPublicationScope
  = { kind: 'all' }
    | { kind: 'applied' }
    | { kind: 'routes', routeIds: readonly string[] }
