import type {
  ServiceConnectionView,
  ServiceEndpointSummary
} from './service-control'

export interface PlatformRuntime {
  defaultDomain: string | null
  activeRevisionId: string | null
  updatedAt: string
}

export interface PlatformApiVersion {
  id: string
  productId: string
  version: string
  state: 'draft' | 'published' | 'deprecated' | 'retired'
  changelog: string
  createdAt: string
  publishedAt: string | null
  deprecatedAt: string | null
  retiredAt: string | null
}

export interface PlatformProductSummary {
  id: string
  slug: string
  name: string
  summary: string
  description: string
  categoryId: number | null
  visibility: 'public' | 'private'
  lifecycle: 'active' | 'deprecated' | 'retired'
  createdAt: string
  updatedAt: string
}

export interface PlatformProduct extends PlatformProductSummary {
  versions: PlatformApiVersion[]
}

export interface PlatformUpstreamTarget {
  id: string
  upstreamServiceId: string
  baseUrl: string
  weight: number
  enabled: boolean
  configurationRevision: number | null
  configurationHash: string | null
  configurationStatus: 'unknown' | 'synced' | 'drifted' | 'error'
  lastConfigurationSyncAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface PlatformUpstreamSummary {
  id: string
  slug: string
  name: string
  loadBalancing: 'round_robin' | 'weighted'
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export interface PlatformUpstream extends PlatformUpstreamSummary {
  targets: PlatformUpstreamTarget[]
  connection: ServiceConnectionView
}

export interface PlatformRoute {
  id: string
  apiVersionId: string
  name: string
  hosts: string[]
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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
  state: 'draft' | 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export interface PlatformRouteBinding {
  route: PlatformRoute
  version: PlatformApiVersion
  product: PlatformProductSummary
  upstream: PlatformUpstreamSummary
}

export type PlatformEndpointPublicationStatus
  = | 'available'
    | 'live'
    | 'pending'
    | 'retiring'
    | 'disabled'

export interface PlatformEndpointCatalogItem {
  key: string
  sourceKind: 'discovered' | 'missing'
  endpoint: ServiceEndpointSummary | null
  route: PlatformRouteBinding | null
  status: PlatformEndpointPublicationStatus
  publishable: boolean
}

/**
 * Why the runtime address of a Target differs from the stored one:
 * - `address_changed`: the runtime still serves the previous address.
 * - `unpublished`: a verified Target is not in the runtime yet.
 * - `withdrawn`: the runtime serves a Target that no longer exists.
 */
export type PlatformTargetRuntimeDriftKind
  = | 'address_changed'
    | 'unpublished'
    | 'withdrawn'

export interface PlatformTargetRuntimeDrift {
  targetId: string
  kind: PlatformTargetRuntimeDriftKind
  runtimeBaseUrl: string | null
  desiredBaseUrl: string | null
}

export interface PlatformEndpointCatalogService {
  upstream: PlatformUpstream
  endpoints: PlatformEndpointCatalogItem[]
  targetDrift: PlatformTargetRuntimeDrift[]
}

export interface PlatformEndpointCatalog {
  activeRevisionId: string | null
  activeRevisionSequence: number | null
  services: PlatformEndpointCatalogService[]
  totals: {
    discovered: number
    live: number
    available: number
    pending: number
    disabled: number
    driftedTargets: number
  }
}

export interface PlatformEndpointPublicationResult {
  route: PlatformRoute
  revision: PlatformRoutingRevision | null
  created?: boolean
}

export interface PlatformEndpointPublicationPatch {
  enabled?: boolean
  name?: string
  isApiKey?: boolean
  isStatistics?: boolean
  creditsCost?: number
  rateLimitPerSecond?: number
  rateLimitPerMinute?: number
  rateLimitPerHour?: number
  rateLimitPerDay?: number
  timeoutMs?: number
  maxRequestBytes?: number
  maxResponseBytes?: number
  catalogStatus?: 'automatic' | 'maintenance'
  sensitiveQueryParameters?: string[]
}

interface PlatformRoutingRevisionPayload {
  schemaVersion: 1
  revisionId: string
  generatedAt: string
  routes: Array<{ id: string }>
  upstreams: Array<{ id: string }>
}

export interface PlatformRoutingRevision {
  id: string
  sequence: number
  configPayload: PlatformRoutingRevisionPayload
  checksum: string
  createdBy: number | null
  createdAt: string
  publishedAt: string
}

export interface PlatformRoutingRevisionSummary {
  id: string
  sequence: number
  routeCount: number
  checksum: string
  createdBy: number | null
  createdAt: string
  publishedAt: string
}
