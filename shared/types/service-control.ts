import type { ServiceConfigurationValue } from '#shared/service-control'
import type { PlatformUpstream } from './platform'

export type {
  RedactedServiceConfigurationState,
  ServiceConfigurationDefinition,
  ServiceConfigurationField,
  ServiceConfigurationGroup,
  ServiceConfigurationOption,
  ServiceConfigurationValue,
  ServiceDescription
} from '#shared/service-control'

export type ServiceConfigurationScalar
  = Exclude<ServiceConfigurationValue, string[]>

export interface StoredServiceConfigurationValues {
  values: Record<string, ServiceConfigurationValue>
  secrets: Record<string, string>
}

export interface ServiceEndpointSummary {
  method: string
  path: string
  operationId: string | null
  summary: string | null
  tags: string[]
  system: boolean
  support: boolean
}

export interface ServiceTargetControlState {
  id: string
  baseUrl: string
  enabled: boolean
  availability: ServiceTargetAvailability
  configurationRevision: number | null
  configurationHash: string | null
  configurationStatus: 'unknown' | 'synced' | 'drifted' | 'error'
  configurationState: RedactedServiceConfigurationState | null
  lastConfigurationSyncAt: string | null
  lastError: string | null
}

export type ServiceAvailability = 'online' | 'degraded' | 'offline' | 'unknown'
export type ServiceTargetAvailability = 'online' | 'offline' | 'unknown'

export interface ServiceConnectionView {
  upstreamServiceId: string
  discovered: boolean
  availability: ServiceAvailability
  tokenConfigured: boolean
  serviceId: string | null
  serviceName: string | null
  serviceVersion: string | null
  serviceCommit: string | null
  serviceProtocol: string | null
  openapiSha256: string | null
  configurationSchemaSha256: string | null
  configurationRevision: number
  configurationHash: string | null
  lastDiscoveredAt: string | null
  lastConfigurationSyncAt: string | null
  lastDiscoveryError: string | null
}

export interface ServiceConfigurationView {
  connection: ServiceConnectionView
  definition: ServiceConfigurationDefinition | null
  values: Record<
    string,
    ServiceConfigurationValue | { configured: boolean }
  >
  targets: ServiceTargetControlState[]
  endpoints: ServiceEndpointSummary[]
}

export interface RoutingRevisionRef {
  id: string
  sequence: number
}

export interface PlatformUpstreamDetail extends ServiceConfigurationView {
  upstream: PlatformUpstream
}

export interface ServiceConfigurationSyncResult {
  status: 'synced' | 'partial' | 'failed'
  /** Service configuration revision, not the routing snapshot sequence. */
  revision: number
  configurationHash: string
  targets: ServiceTargetControlState[]
  /** Saved normalized values; secrets are represented only by configured flags. */
  values: ServiceConfigurationView['values']
}

export interface ServiceControlRoutingOutcome {
  /** Runtime snapshot published as a result of this sync, if any. */
  routingRevision: RoutingRevisionRef | null
  routingStatus: 'applied' | 'pending' | 'skipped'
}

export interface ServiceConfigurationSyncOutcome
  extends ServiceConfigurationSyncResult, ServiceControlRoutingOutcome {}

export interface ServiceDiscoveryOutcome
  extends ServiceConfigurationView, ServiceControlRoutingOutcome {}
