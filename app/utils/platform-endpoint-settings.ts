import type { PlatformEndpointPublicationPatch, PlatformRoute } from '#shared/types/platform'

export interface EndpointSettingsForm {
  name: string
  isApiKey: boolean
  isStatistics: boolean
  creditsCost: number
  rateLimitPerSecond: number
  rateLimitPerMinute: number
  rateLimitPerHour: number
  rateLimitPerDay: number
  timeoutMs: number
  maxRequestKiB: number
  maxResponseKiB: number
  catalogStatus: PlatformRoute['catalogStatus']
  sensitiveQueryParameters: string[]
  enabled: boolean
}

export function createEndpointSettingsForm(route: PlatformRoute): EndpointSettingsForm {
  return {
    name: route.name,
    isApiKey: route.isApiKey,
    isStatistics: route.isStatistics,
    creditsCost: route.creditsCost,
    rateLimitPerSecond: route.rateLimitPerSecond,
    rateLimitPerMinute: route.rateLimitPerMinute,
    rateLimitPerHour: route.rateLimitPerHour,
    rateLimitPerDay: route.rateLimitPerDay,
    timeoutMs: route.timeoutMs,
    maxRequestKiB: route.maxRequestBytes / 1024,
    maxResponseKiB: route.maxResponseBytes / 1024,
    catalogStatus: route.catalogStatus,
    sensitiveQueryParameters: [...route.sensitiveQueryParameters],
    enabled: route.state === 'active'
  }
}

export function endpointSettingsPayload(state: EndpointSettingsForm): PlatformEndpointPublicationPatch {
  return {
    name: state.name.trim(),
    isApiKey: state.isApiKey,
    isStatistics: state.isStatistics,
    creditsCost: state.creditsCost,
    rateLimitPerSecond: state.rateLimitPerSecond,
    rateLimitPerMinute: state.rateLimitPerMinute,
    rateLimitPerHour: state.rateLimitPerHour,
    rateLimitPerDay: state.rateLimitPerDay,
    timeoutMs: state.timeoutMs,
    maxRequestBytes: state.maxRequestKiB * 1024,
    maxResponseBytes: state.maxResponseKiB * 1024,
    catalogStatus: state.catalogStatus,
    sensitiveQueryParameters: Array.from(new Set(
      state.sensitiveQueryParameters.map(item => item.trim()).filter(Boolean)
    )),
    enabled: state.enabled
  }
}
