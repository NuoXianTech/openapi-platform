import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createApp, eventHandler, toNodeListener, type H3Event } from 'h3'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), resolve: vi.fn(), mark: vi.fn(), release: vi.fn() }))
vi.mock('~~/server/services/dynamic-gateway-access-service', () => ({ dynamicGatewayAccessService: { authorize: mocks.authorize } }))
vi.mock('~~/server/services/routing-runtime-service', () => ({ routingRuntimeService: { resolve: mocks.resolve, resolveAllowedMethods: async () => [] } }))
vi.mock('~~/server/services/credit-service', () => ({ creditService: { markReservationPending: mocks.mark, releaseReservation: mocks.release } }))
vi.mock('~~/server/services/upstream-service-token-service', () => ({ upstreamServiceTokenService: { get: async () => 'review-service-token' } }))
vi.mock('~~/server/utils/redis', () => ({ getRedisClient: () => null, getRedisConfig: () => ({ keyPrefix: 'test:' }) }))
const { dynamicGatewayService } = await import('~~/server/services/dynamic-gateway-service')
const { closeSafeFetchTransports } = await import('~~/server/utils/safe-fetch')
const match: ResolvedDynamicRoute = {
  revisionId: '00000000-0000-4000-8000-000000000002',
  params: {},
  route: {
    id: '00000000-0000-4000-8000-000000000003',
    productId: '00000000-0000-4000-8000-000000000004',
    productSlug: 'stream',
    productVisibility: 'public',
    productLifecycle: 'active',
    versionId: '00000000-0000-4000-8000-000000000005',
    version: 'v1',
    versionState: 'published',
    name: 'Stream',
    hosts: [],
    method: 'GET',
    pathPattern: '/v1/stream',
    normalizedShape: '/v1/stream',
    upstreamServiceId: '00000000-0000-4000-8000-000000000006',
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
    id: '00000000-0000-4000-8000-000000000006',
    loadBalancing: 'round_robin',
    targets: [{
      id: '00000000-0000-4000-8000-000000000007',
      baseUrl: 'http://127.0.0.1:8080',
      weight: 1
    }]
  }
}


let lastEvent: H3Event
let upstreamHandler: (request: IncomingMessage, response: ServerResponse) => void
const upstream = createServer((req, res) => upstreamHandler(req, res))
await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve))
match.upstream.targets[0]!.baseUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
const originalMatch = structuredClone(match)
const app = createApp()
app.use(eventHandler(async event => (await dynamicGatewayService.tryHandle(event)).response))
const gateway = createServer(toNodeListener(app))
await new Promise<void>(resolve => gateway.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${(gateway.address() as { port: number }).port}/v1/stream`

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(match, structuredClone(originalMatch))
  mocks.resolve.mockResolvedValue(match)
  mocks.mark.mockImplementation(() => {
    expect(lastEvent.node.res.headersSent).toBe(false)
    return Promise.resolve(true)
  })
  mocks.release.mockResolvedValue(true)
  mocks.authorize.mockImplementation((event: H3Event) => {
    lastEvent = event
    event.context.apiBilling = {
      costCredits: match.route.creditsCost,
      apiKeyUserId: 7,
      creditReservation: match.route.creditsCost > 0 ? { id: 11, userId: 7, amount: 2 } : null
    }
    return Promise.resolve({ passed: true })
  })
  upstreamHandler = (_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'public, max-age=86400')
    res.setHeader('cdn-cache-control', 'public, s-maxage=86400')
    res.setHeader('cloudflare-cdn-cache-control', 'public, max-age=86400')
    res.setHeader('surrogate-control', 'max-age=86400')
    res.setHeader('expires', 'Wed, 01 Jan 2031 00:00:00 GMT')
    res.end(JSON.stringify({ code: 'OK', data: 'paid-result' }))
  }
})
afterAll(async () => {
  await closeSafeFetchTransports()
  await Promise.all([upstream, gateway].map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

describe('gateway over HTTP', () => {
  it('waits for the whole paid body and durable billing before sending any bytes', async () => {
    let upstreamResponse: ServerResponse | undefined
    upstreamHandler = (_req, res) => {
      upstreamResponse = res
      res.write('paid-')
    }
    const request = fetch(url)
    await vi.waitFor(() => expect(upstreamResponse).toBeDefined())
    expect(mocks.mark).not.toHaveBeenCalled()
    expect(lastEvent.node.res.headersSent).toBe(false)
    upstreamResponse!.end('result')
    const response = await request
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('paid-result')
    expect(mocks.mark).toHaveBeenCalledWith(11, 7)
    expect(mocks.release).not.toHaveBeenCalled()
  })

  it('returns 503 without the successful payload when billing persistence fails', async () => {
    mocks.mark.mockRejectedValueOnce(new Error('simulated database failure'))
    const response = await fetch(url)
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toMatchObject({ code: 'BILLING_UNAVAILABLE', data: null })
    expect(JSON.stringify(body)).not.toContain('paid-result')
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('rejects a late oversized chunk without exposing the paid prefix', async () => {
    match.route.maxResponseBytes = 8
    upstreamHandler = (_req, res) => {
      res.write('paid-')
      setImmediate(() => res.end('result-too-large'))
    }
    const response = await fetch(url)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ code: 'UPSTREAM_RESPONSE_TOO_LARGE' })
    expect(mocks.mark).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('releases a reservation when the client disconnects during the paid body', async () => {
    let started = false
    upstreamHandler = (_req, res) => { res.write('partial'); started = true }
    const controller = new AbortController()
    const request = fetch(url, { signal: controller.signal })
    const rejected = expect(request).rejects.toThrow()
    await vi.waitFor(() => expect(started).toBe(true))
    controller.abort()
    await rejected
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
    expect(mocks.mark).not.toHaveBeenCalled()
  })

  it('releases failed calls without creating a settlement intent', async () => {
    upstreamHandler = (_req, res) => { res.statusCode = 422; res.end('business-error') }
    const response = await fetch(url)
    expect(response.status).toBe(422)
    expect(await response.text()).toBe('business-error')
    expect(mocks.mark).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledOnce()
  })

  it('persists billing for a successful response without a body', async () => {
    upstreamHandler = (_req, res) => { res.statusCode = 204; res.end() }
    const response = await fetch(url)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(mocks.mark).toHaveBeenCalledOnce()
  })

  it.each([
    { isApiKey: true, isStatistics: false, creditsCost: 0 },
    { isApiKey: false, isStatistics: true, creditsCost: 0 },
    { isApiKey: false, isStatistics: false, creditsCost: 0, rateLimitPerMinute: 1 },
    { isApiKey: true, isStatistics: true, creditsCost: 2 }
  ])('prevents cache hits from bypassing governance: %j', async policy => {
    Object.assign(match.route, policy)
    const response = await fetch(url)
    await response.text()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('cdn-cache-control')).toBe('no-store')
    expect(response.headers.get('surrogate-control')).toBe('no-store')
    expect(response.headers.has('cloudflare-cdn-cache-control')).toBe(false)
    expect(response.headers.has('expires')).toBe(false)
  })

  it('preserves caching for anonymous support resources without governance', async () => {
    Object.assign(match.route, { isApiKey: false, isStatistics: false, creditsCost: 0, isSupportRoute: true })
    const response = await fetch(url)
    await response.text()
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400')
  })

  it('keeps free responses streaming before the upstream finishes', async () => {
    match.route.creditsCost = 0
    let upstreamResponse: ServerResponse | undefined
    upstreamHandler = (_req, res) => { upstreamResponse = res; res.write('first') }
    const response = await fetch(url)
    const reader = response.body!.getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('first')
    upstreamResponse!.end('last')
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('last')
    expect((await reader.read()).done).toBe(true)
    expect(mocks.mark).not.toHaveBeenCalled()
  })
})