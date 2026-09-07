import { describe, expect, it } from 'vitest'
import type { PlatformRoute } from '#shared/types/platform'
import { createEndpointSettingsForm, endpointSettingsPayload } from '~/utils/platform-endpoint-settings'

const route = {
  id: 'route-1',
  name: 'Service endpoint',
  method: 'GET',
  pathPattern: '/v1/weather',
  upstreamServiceId: 'service-1',
  upstreamPathTemplate: '/v1/weather',
  apiVersionId: 'version-1',
  hosts: [],
  isApiKey: true,
  isStatistics: true,
  creditsCost: 2,
  rateLimitPerSecond: 1,
  rateLimitPerMinute: 10,
  rateLimitPerHour: 100,
  rateLimitPerDay: 1000,
  timeoutMs: 5000,
  maxRequestBytes: 2048,
  maxResponseBytes: 4096,
  catalogStatus: 'automatic',
  sensitiveQueryParameters: ['token'],
  state: 'active'
} as PlatformRoute

describe('endpoint settings', () => {
  it('preserves governance and converts form sizes without exposing contract fields', () => {
    const state = createEndpointSettingsForm(route)
    state.name = '  Updated endpoint  '
    state.sensitiveQueryParameters = [' token ', 'token', '']
    state.enabled = false

    expect(state.maxRequestKiB).toBe(2)
    expect(state.maxResponseKiB).toBe(4)
    expect(endpointSettingsPayload(state)).toEqual({
      name: 'Updated endpoint',
      enabled: false,
      isApiKey: true,
      isStatistics: true,
      creditsCost: 2,
      rateLimitPerSecond: 1,
      rateLimitPerMinute: 10,
      rateLimitPerHour: 100,
      rateLimitPerDay: 1000,
      timeoutMs: 5000,
      maxRequestBytes: 2048,
      maxResponseBytes: 4096,
      catalogStatus: 'automatic',
      sensitiveQueryParameters: ['token']
    })
    expect(route.sensitiveQueryParameters).toEqual(['token'])
  })
})
