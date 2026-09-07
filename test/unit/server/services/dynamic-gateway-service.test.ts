import { EventEmitter } from 'node:events'
import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  getServiceToken: vi.fn(),
  markReservationPending: vi.fn(),
  releaseReservation: vi.fn(),
  resolve: vi.fn(),
  resolveAllowedMethods: vi.fn(),
  sendProxy: vi.fn()
}))

vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return {
    ...actual,
    getHeader: (event: H3Event, name: string) => (
      event.node.req.headers[name.toLowerCase()] as string | undefined
    ),
    getProxyRequestHeaders: (event: H3Event) => event.node.req.headers,
    getRequestIP: () => undefined,
    getRequestProtocol: () => 'http',
    getRequestURL: () => new URL('http://api.example.test/v1/stream'),
    getRequestWebStream: () => undefined,
    sendNoContent: vi.fn(),
    sendProxy: mocks.sendProxy,
    setResponseHeader: vi.fn(),
    setResponseHeaders: vi.fn(),
    setResponseStatus: (event: H3Event, status: number) => {
      event.node.res.statusCode = status
    }
  }
})

vi.mock('~~/server/services/dynamic-gateway-access-service', () => ({
  dynamicGatewayAccessService: { authorize: mocks.authorize }
}))
vi.mock('~~/server/services/routing-runtime-service', () => ({
  routingRuntimeService: {
    resolve: mocks.resolve,
    resolveAllowedMethods: mocks.resolveAllowedMethods
  }
}))
vi.mock('~~/server/services/credit-service', () => ({
  creditService: {
    markReservationPending: mocks.markReservationPending,
    releaseReservation: mocks.releaseReservation
  }
}))
vi.mock('~~/server/services/upstream-service-token-service', () => ({
  upstreamServiceTokenService: { get: mocks.getServiceToken }
}))

const { createUpstreamHeaders, dynamicGatewayService } = await import(
  '~~/server/services/dynamic-gateway-service'
)

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

function createEvent(): H3Event {
  const request = new EventEmitter() as EventEmitter & {
    headers: Record<string, string | undefined>
  }
  request.headers = {}
  const response = new EventEmitter() as EventEmitter & {
    headersSent: boolean
    writableEnded: boolean
    statusCode: number
    destroy: ReturnType<typeof vi.fn>
  }
  response.headersSent = false
  response.writableEnded = false
  response.statusCode = 200
  response.destroy = vi.fn()
  return {
    method: 'GET',
    context: {},
    node: { req: request, res: response }
  } as unknown as H3Event
}

function installBilling(event: H3Event) {
  event.context.apiBilling = {
    costCredits: 2,
    apiKeyUserId: 7,
    creditReservation: { id: 11, userId: 7, amount: 2 }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue(match)
  mocks.resolveAllowedMethods.mockResolvedValue([])
  mocks.getServiceToken.mockResolvedValue('service-token')
  mocks.markReservationPending.mockResolvedValue(true)
  mocks.releaseReservation.mockResolvedValue(true)
  mocks.authorize.mockImplementation(async (event: H3Event) => {
    installBilling(event)
    return { passed: true }
  })
})

describe('dynamic gateway streaming billing', () => {
  it('requires Service authentication for every upstream request', () => {
    expect(() => createUpstreamHeaders(createEvent(), match, ''))
      .toThrow('上游服务凭证尚未配置')
  })

  it('owns forwarding metadata instead of relaying caller supplied values', () => {
    const event = createEvent()
    event.node.req.headers = {
      'authorization': 'Bearer caller-token',
      'forwarded': 'for=attacker',
      'x-forwarded-for': '198.51.100.7',
      'x-forwarded-host': 'attacker.example',
      'x-real-ip': '198.51.100.8',
      'x-business-header': 'keep-me'
    }

    const headers = createUpstreamHeaders(event, match, 'service-token')

    expect(headers.get('authorization')).toBe('Service service-token')
    expect(headers.get('forwarded')).toBeNull()
    expect(headers.get('x-forwarded-for')).toBeNull()
    expect(headers.get('x-forwarded-host')).toBe('api.example.test')
    expect(headers.get('x-real-ip')).toBeNull()
    expect(headers.get('x-business-header')).toBe('keep-me')
  })

  it('forwards the public protocol resolved by the trusted proxy boundary', () => {
    const event = createEvent()
    event.context.publicRequestProtocol = 'https'

    const headers = createUpstreamHeaders(event, match, 'service-token')

    expect(headers.get('x-forwarded-proto')).toBe('https')
  })

  it('does not settle a paid call before the streamed response completes', async () => {
    const event = createEvent()
    let finishProxy: (() => Promise<void>) | null = null
    mocks.sendProxy.mockImplementation((proxyEvent, _url, options) => (
      new Promise((resolve, reject) => {
        finishProxy = async () => {
          await options.onResponse?.(
            proxyEvent,
            new Response('streamed', { status: 200 })
          )
          resolve('streamed')
        }
        options.fetchOptions?.signal?.addEventListener(
          'abort',
          () => reject(options.fetchOptions?.signal?.reason),
          { once: true }
        )
      })
    ))

    const handling = dynamicGatewayService.tryHandle(event)
    await vi.waitFor(() => expect(mocks.sendProxy).toHaveBeenCalledOnce())
    expect(mocks.markReservationPending).not.toHaveBeenCalled()
    expect(mocks.releaseReservation).not.toHaveBeenCalled()

    await finishProxy?.()
    await expect(handling).resolves.toMatchObject({
      matched: true,
      response: 'streamed'
    })
    expect(mocks.markReservationPending).toHaveBeenCalledWith(11, 7)
    expect(mocks.releaseReservation).not.toHaveBeenCalled()
  })

  it('releases the reservation when the client interrupts the stream', async () => {
    const event = createEvent()
    mocks.sendProxy.mockImplementation((_proxyEvent, _url, options) => (
      new Promise((_resolve, reject) => {
        options.fetchOptions?.signal?.addEventListener(
          'abort',
          () => reject(options.fetchOptions?.signal?.reason),
          { once: true }
        )
      })
    ))

    const handling = dynamicGatewayService.tryHandle(event)
    await vi.waitFor(() => expect(mocks.sendProxy).toHaveBeenCalledOnce())
    event.node.req.emit('aborted')

    await expect(handling).resolves.toMatchObject({ matched: true })
    expect(mocks.releaseReservation).toHaveBeenCalledWith(11, 7)
    expect(mocks.markReservationPending).not.toHaveBeenCalled()
    expect(event.context.apiBilling?.creditReservation).toBeNull()
    expect(event.node.res.statusCode).toBe(499)
    expect(event.context.apiFailure).toEqual({
      errorCode: 'CLIENT_DISCONNECTED',
      errorMessage: '客户端已断开连接'
    })
  })
})
