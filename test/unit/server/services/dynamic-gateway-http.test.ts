import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createApp, eventHandler, toNodeListener, type H3Event } from 'h3'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gatewayCallService } from '~~/server/services/dynamic-gateway-call-service'
import { gatewayTargetHealth } from '~~/server/services/gateway-target-health'
import { resetGatewayTargetHealth } from '~~/server/services/dynamic-gateway-transport'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(), resolve: vi.fn(), mark: vi.fn(), release: vi.fn(),
  record: vi.fn(), addCall: vi.fn(), link: vi.fn(), finalize: vi.fn(), usage: vi.fn(), token: vi.fn()
}))
vi.mock('~~/server/services/dynamic-gateway-access-service', () => ({ dynamicGatewayAccessService: { authorize: mocks.authorize } }))
vi.mock('~~/server/services/routing-runtime-service', async (original) => ({
  ...await original<typeof import('~~/server/services/routing-runtime-service')>(),
  routingRuntimeService: { resolve: mocks.resolve }
}))
vi.mock('~~/server/services/credit-service', () => ({ creditService: {
  markReservationPending: mocks.mark, releaseReservation: mocks.release,
  linkApiCall: mocks.link, finalizeReservation: mocks.finalize
} }))
vi.mock('~~/server/services/api-call-service', () => ({ apiCallService: {
  addCallAndUpsertDailyStat: mocks.record, addCall: mocks.addCall
} }))
vi.mock('~~/server/services/api-key-service', () => ({ apiKeyService: { recordUsage: mocks.usage } }))
vi.mock('~~/server/services/upstream-service-token-service', () => ({ upstreamServiceTokenService: { get: mocks.token } }))
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
  resetGatewayTargetHealth()
  vi.clearAllMocks()
  Object.assign(match, structuredClone(originalMatch))
  mocks.resolve.mockResolvedValue({ match, allowedMethods: ['GET', 'HEAD'] })
  mocks.token.mockResolvedValue('review-service-token')
  mocks.mark.mockImplementation(() => {
    expect(lastEvent.node.res.headersSent).toBe(false)
    return Promise.resolve(true)
  })
  mocks.release.mockResolvedValue(true)
  mocks.record.mockResolvedValue(42)
  mocks.addCall.mockResolvedValue([{ id: 42 }])
  mocks.link.mockResolvedValue(undefined)
  mocks.finalize.mockResolvedValue({ charged: 2 })
  mocks.usage.mockResolvedValue(undefined)
  mocks.authorize.mockImplementation((event: H3Event) => {
    lastEvent = event
    gatewayCallService.acceptAccess(event, { id: 1, userId: 7, name: 'Test' }, match.route.creditsCost > 0 ? { id: 11, userId: 7, amount: 2 } : null)
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
afterEach(() => { vi.restoreAllMocks() })
afterAll(async () => {
  await closeSafeFetchTransports()
  await Promise.all([upstream, gateway].map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
})

describe('gateway over HTTP', () => {
  it('rejects a missing Service credential before dispatching and releases the reservation', async () => {
    mocks.token.mockResolvedValue('')
    const received = vi.fn()
    upstreamHandler = received
    const response = await fetch(url)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'UPSTREAM_AUTH_UNAVAILABLE' })
    expect(received).not.toHaveBeenCalled()
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(11, 7)
    expect(mocks.mark).not.toHaveBeenCalled()
  })

  it('replaces caller credentials and forwarding metadata on the actual upstream request', async () => {
    let received: IncomingMessage['headers'] | undefined
    upstreamHandler = (req, res) => { received = req.headers; res.end('ok') }
    const response = await fetch(url, { headers: {
      'authorization': 'Bearer caller-token',
      'cookie': 'session=private',
      'x-api-key': 'private-api-key',
      'forwarded': 'for=attacker',
      'x-forwarded-for': '198.51.100.7',
      'x-forwarded-host': 'attacker.example',
      'x-real-ip': '198.51.100.8',
      'x-openapi-route-id': 'forged-route',
      'x-business-header': 'keep-me'
    } })
    expect(await response.text()).toBe('ok')
    expect(received).toMatchObject({
      'authorization': 'Service review-service-token',
      'x-forwarded-host': new URL(url).host,
      'x-forwarded-for': '127.0.0.1',
      'x-forwarded-proto': 'http',
      'x-openapi-route-id': match.route.id,
      'x-business-header': 'keep-me'
    })
    for (const header of ['cookie', 'x-api-key', 'forwarded', 'x-real-ip']) expect(received?.[header]).toBeUndefined()
  })

  it('forwards the public protocol supplied by the trusted request context', async () => {
    const authorize = mocks.authorize.getMockImplementation()!
    mocks.authorize.mockImplementationOnce((event: H3Event) => {
      event.context.publicRequestProtocol = 'https'
      return authorize(event)
    })
    let protocol: string | string[] | undefined
    upstreamHandler = (req, res) => { protocol = req.headers['x-forwarded-proto']; res.end('ok') }
    expect(await (await fetch(url)).text()).toBe('ok')
    expect(protocol).toBe('https')
  })

  it.each([
    ['POST', ['GET', 'HEAD'], 405],
    ['OPTIONS', ['GET', 'HEAD'], 204],
    ['POST', [], 404],
    ['OPTIONS', [], 404]
  ] as const)('presents %s with %j from one routing decision as HTTP %s', async (method, allowedMethods, status) => {
    mocks.resolve.mockResolvedValue({ match: null, allowedMethods })
    const response = await fetch(url, { method })
    expect(response.status).toBe(status)
    if (status === 405) expect(response.headers.get('allow')).toBe('GET, HEAD')
    if (status === 204) expect(response.headers.get('access-control-allow-methods')).toContain('GET')
    await response.arrayBuffer()
    expect(mocks.resolve).toHaveBeenCalledOnce()
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('returns unavailable instead of a missing route when the routing read fails', async () => {
    mocks.resolve.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'ROUTING_RUNTIME_UNAVAILABLE' }))
    const response = await fetch(url)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'ROUTING_RUNTIME_UNAVAILABLE' })
    expect(mocks.resolve).toHaveBeenCalledOnce()
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it.each(['deadline', 'disconnect'] as const)('cleans up a timed-out first Target and a streaming replacement on %s', async (ending) => {
    match.route.timeoutMs = 2_700
    const baseUrl = match.upstream.targets[0]!.baseUrl
    match.upstream.targets = [
      { id: 'slow-target', baseUrl: baseUrl + '/slow', weight: 1 },
      { id: 'replacement-target', baseUrl: baseUrl + '/replacement', weight: 1 }
    ]
    const requests: string[] = []
    const closed = new Set<string>()
    upstreamHandler = (req, res) => {
      const path = req.url!
      requests.push(path)
      res.once('close', () => closed.add(path))
      if (path.startsWith('/replacement')) res.write('paid-prefix')
    }
    const health = vi.spyOn(gatewayTargetHealth, 'report')
    const controller = new AbortController()
    const pending = fetch(url, { signal: controller.signal })
    const result = pending.then(response => response.json(), () => null)
    await vi.waitFor(() => expect(requests).toHaveLength(2), { timeout: 4_000 })
    if (ending === 'disconnect') controller.abort()
    const body = await result
    if (ending === 'deadline') expect(body).toMatchObject({ code: 'UPSTREAM_TIMEOUT' })
    await vi.waitFor(() => expect(closed.size).toBe(2))
    await vi.waitFor(() => expect(mocks.release).toHaveBeenCalledOnce())
    expect(mocks.mark).not.toHaveBeenCalled()
    expect(health.mock.calls.filter(([, healthy]) => !healthy)).toHaveLength(1)
    expect(lastEvent.node.req.listenerCount('aborted')).toBe(0)
  }, 6_000)

  it('coalesces concurrent and repeated completion without replaying calls or settlement', async () => {
    await (await fetch(url)).text()
    let finishRecord!: (id: number) => void
    mocks.record.mockImplementationOnce(() => new Promise<number>(resolve => { finishRecord = resolve }))
    const first = gatewayCallService.complete(lastEvent)
    const repeated = gatewayCallService.complete(lastEvent)
    expect(repeated).toBe(first)
    expect(mocks.record).toHaveBeenCalledOnce()
    expect(mocks.finalize).not.toHaveBeenCalled()
    finishRecord(42)
    await Promise.all([first, repeated])
    await gatewayCallService.complete(lastEvent)
    await gatewayCallService.release(lastEvent)
    expect(mocks.record).toHaveBeenCalledOnce()
    expect(mocks.link).toHaveBeenCalledExactlyOnceWith(11, 42)
    expect(mocks.finalize).toHaveBeenCalledExactlyOnceWith({
      reservationId: 11, apiCallId: 42, remark: 'API 调用扣费 · /v1/stream'
    })
    expect(mocks.usage).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()
    expect(mocks.record.mock.calls[0]![0]).toMatchObject({
      upstreamTargetId: match.upstream.targets[0]!.id,
      upstreamTargetUrl: match.upstream.targets[0]!.baseUrl,
      responseSize: new TextEncoder().encode(JSON.stringify({ code: 'OK', data: 'paid-result' })).length
    })
  })

  it.each(['record', 'finalize'] as const)('leaves durable billing for recovery after %s fails', async (operation) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks[operation].mockRejectedValueOnce(new Error('database unavailable'))
    await (await fetch(url)).text()
    await gatewayCallService.complete(lastEvent)
    await gatewayCallService.complete(lastEvent)
    expect(mocks.mark).toHaveBeenCalledOnce()
    expect(mocks.release).not.toHaveBeenCalled()
    expect(mocks.record).toHaveBeenCalledOnce()
    expect(mocks.finalize).toHaveBeenCalledTimes(operation === 'finalize' ? 1 : 0)
  })

  it('does not release failed-call credits again when the response hook repeats', async () => {
    upstreamHandler = (_req, res) => { res.statusCode = 422; res.end('business-error') }
    await (await fetch(url)).text()
    await Promise.all([gatewayCallService.complete(lastEvent), gatewayCallService.complete(lastEvent)])
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.record).toHaveBeenCalledOnce()
  })

  it('retries a failed error-path release during completion without recording twice', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.release.mockRejectedValueOnce(new Error('release temporarily unavailable'))
    mocks.mark.mockRejectedValueOnce(new Error('billing temporarily unavailable'))
    const response = await fetch(url)
    expect(response.status).toBe(503)
    await response.text()
    await gatewayCallService.complete(lastEvent)
    await gatewayCallService.complete(lastEvent)
    expect(mocks.release).toHaveBeenCalledTimes(2)
    expect(mocks.record).toHaveBeenCalledOnce()
    expect(mocks.finalize).not.toHaveBeenCalled()
  })

  it('keeps successful billing recoverable when statistics are disabled', async () => {
    match.route.isStatistics = false
    await (await fetch(url)).text()
    await gatewayCallService.complete(lastEvent)
    expect(mocks.mark).toHaveBeenCalledOnce()
    expect(mocks.record).not.toHaveBeenCalled()
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(mocks.release).not.toHaveBeenCalled()
  })

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
    await gatewayCallService.release(lastEvent)
    expect(mocks.release).toHaveBeenCalledExactlyOnceWith(11, 7)
    expect(lastEvent.node.res.statusCode).toBe(499)
    expect(lastEvent.context.apiFailure).toMatchObject({ errorCode: 'CLIENT_DISCONNECTED' })
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
