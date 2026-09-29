import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoutingRevisionPayload } from '~~/server/types/routing-revision'
import { canonicalJson } from '~~/server/utils/canonical-json'

const mocks = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('~~/server/db/client', () => ({ db: {
  select: () => ({ from: () => ({ innerJoin: () => ({ limit: mocks.read }) }) })
} }))

function row(id: string) {
  const payload: RoutingRevisionPayload = {
    schemaVersion: 1, revisionId: id, generatedAt: '2026-01-01T00:00:00.000Z', defaultDomain: null,
    upstreams: [{ id: 'upstream', loadBalancing: 'round_robin', targets: [{ id: 'target', baseUrl: 'https://upstream.test', weight: 1 }] }],
    routes: [{
      id: 'route', productId: 'product', productSlug: 'product', productVisibility: 'public', productLifecycle: 'active',
      versionId: 'version', version: 'v1', versionState: 'published', name: 'Route', hosts: [], method: 'GET',
      pathPattern: '/v1/test', normalizedShape: '/v1/test', upstreamServiceId: 'upstream', upstreamPathTemplate: '/v1/test',
      isApiKey: false, isStatistics: false, creditsCost: 0, rateLimitPerSecond: 0, rateLimitPerMinute: 0,
      rateLimitPerHour: 0, rateLimitPerDay: 0, timeoutMs: 5000, maxRequestBytes: 0, maxResponseBytes: 1024,
      catalogStatus: 'automatic', sensitiveQueryParameters: [], isSupportRoute: false
    }]
  }
  return { revisionId: id, defaultDomain: null, payload, checksum: createHash('sha256').update(canonicalJson(payload)).digest('hex') }
}

describe('routing runtime snapshots', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.read.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(100_000)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('starts a new read after publication without joining or caching the old producer', async () => {
    let finish!: (rows: ReturnType<typeof row>[]) => void
    mocks.read.mockReturnValueOnce(new Promise(resolve => { finish = resolve })).mockResolvedValue([row('new')])
    const { routingRuntimeService: runtime, invalidateRoutingRuntimeCache } = await import('~~/server/services/routing-runtime-service')
    const old = runtime.resolve('GET', '/v1/test', 'api.test')
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledOnce())
    invalidateRoutingRuntimeCache()
    await expect(runtime.resolve('GET', '/v1/test', 'api.test')).resolves.toMatchObject({ revisionId: 'new' })
    finish([row('old')])
    await old
    await expect(runtime.resolve('GET', '/v1/test', 'api.test')).resolves.toMatchObject({ revisionId: 'new' })
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it('keeps a verified snapshot across invalidation failures but never extends its stale deadline', async () => {
    mocks.read.mockResolvedValueOnce([row('verified')]).mockRejectedValue(new Error('offline'))
    const { routingRuntimeService: runtime, invalidateRoutingRuntimeCache } = await import('~~/server/services/routing-runtime-service')
    await runtime.resolve('GET', '/v1/test', 'api.test')
    vi.mocked(Date.now).mockReturnValue(159_500)
    invalidateRoutingRuntimeCache()
    await expect(runtime.resolve('GET', '/v1/test', 'api.test')).resolves.toMatchObject({ revisionId: 'verified' })
    vi.mocked(Date.now).mockReturnValue(160_001)
    await expect(runtime.resolve('GET', '/v1/test', 'api.test')).rejects.toMatchObject({ code: 'ROUTING_RUNTIME_UNAVAILABLE' })
    expect(mocks.read).toHaveBeenCalledTimes(2)
  })

  it('does not use stale routing when a failed refresh itself outlasts the fallback window', async () => {
    mocks.read.mockResolvedValueOnce([row('verified')])
    const { routingRuntimeService: runtime } = await import('~~/server/services/routing-runtime-service')
    await runtime.resolve('GET', '/v1/test', 'api.test')
    vi.mocked(Date.now).mockReturnValue(101_001)
    let fail!: (error: Error) => void
    mocks.read.mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject }))
    const loading = runtime.resolve('GET', '/v1/test', 'api.test')
    const rejected = expect(loading).rejects.toMatchObject({ code: 'ROUTING_RUNTIME_UNAVAILABLE' })
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
    vi.mocked(Date.now).mockReturnValue(160_001)
    fail(new Error('slow database failure'))
    await rejected
  })

  it('still rejects an unverified checksum and treats a missing active revision as empty', async () => {
    mocks.read.mockResolvedValueOnce([{ ...row('corrupt'), checksum: 'invalid' }]).mockResolvedValueOnce([])
    const { routingRuntimeService: runtime } = await import('~~/server/services/routing-runtime-service')
    await expect(runtime.resolve('GET', '/v1/test', 'api.test')).rejects.toMatchObject({ code: 'ROUTING_RUNTIME_UNAVAILABLE' })
    await expect(runtime.resolve('GET', '/v1/test', 'api.test')).resolves.toBeNull()
  })
})
