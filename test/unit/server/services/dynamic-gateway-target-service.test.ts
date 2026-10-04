import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'
import {
  buildGatewayTargetUrl,
  createGatewayProxyFetch,
  orderedGatewayTargets,
  resetGatewayTargetHealth
} from '~~/server/services/dynamic-gateway-transport'

vi.mock('~~/server/utils/safe-fetch', () => ({
  safeFetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)
}))

function match(
  id: string,
  loadBalancing: 'round_robin' | 'weighted',
  weights: number[],
  timeoutMs = 10_000
): ResolvedDynamicRoute {
  return {
    route: { timeoutMs },
    upstream: {
      id,
      loadBalancing,
      targets: weights.map((weight, index) => ({
        id: `${id}-${index}`,
        baseUrl: `http://127.0.0.1:808${index}`,
        weight
      }))
    }
  } as ResolvedDynamicRoute
}

function proxyFor(route: ResolvedDynamicRoute, targets = route.upstream.targets) {
  return createGatewayProxyFetch({
    match: route,
    targets,
    upstreamPath: '/v1/yiyan',
    search: '',
    maximumResponseBytes: 1024,
    onTarget: vi.fn(),
    onResponseBytes: vi.fn()
  })
}

describe('dynamic gateway target selection', () => {
  beforeEach(() => {
    resetGatewayTargetHealth()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetGatewayTargetHealth()
  })
  it('does not dispatch or blame a Target when the transfer was already aborted', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    const controller = new AbortController()
    controller.abort(new Error('already disconnected'))
    await expect(proxyFor(match('pre-abort', 'round_robin', [1, 1]))('http://gateway.invalid', {
      signal: controller.signal
    })).rejects.toThrow('already disconnected')
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['close', 'error', 'cancel'] as const)('releases the final attempt abort listener when its body ends with %s', async (end) => {
    let source!: ReadableStreamDefaultController<Uint8Array>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) { source = controller; controller.enqueue(new Uint8Array([1])) }
    }))))
    const controller = new AbortController()
    const add = vi.spyOn(controller.signal, 'addEventListener')
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const response = await proxyFor(match('stream-' + end, 'round_robin', [1]))('http://gateway.invalid', { signal: controller.signal })
    const reader = response.body!.getReader()
    expect((await reader.read()).value).toEqual(new Uint8Array([1]))
    const listener = add.mock.calls.find(call => call[0] === 'abort')![1]
    expect(remove).not.toHaveBeenCalledWith('abort', listener)
    if (end === 'close') { source.close(); expect((await reader.read()).done).toBe(true) }
    if (end === 'error') { source.error(new Error('broken stream')); await expect(reader.read()).rejects.toThrow('broken stream') }
    if (end === 'cancel') await reader.cancel('client stopped reading')
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', listener)
  })

  it('rotates round-robin targets for each request', () => {
    const route = match('round-robin-test', 'round_robin', [1, 1, 1])

    expect(Array.from({ length: 4 }, () => (
      orderedGatewayTargets(route)[0]?.id
    ))).toEqual([
      'round-robin-test-0',
      'round-robin-test-1',
      'round-robin-test-2',
      'round-robin-test-0'
    ])
  })

  it('uses deterministic weighted rotation without random imbalance', () => {
    const route = match('weighted-test', 'weighted', [3, 1])

    expect(Array.from({ length: 8 }, () => (
      orderedGatewayTargets(route)[0]?.id
    ))).toEqual([
      'weighted-test-0',
      'weighted-test-0',
      'weighted-test-0',
      'weighted-test-1',
      'weighted-test-0',
      'weighted-test-0',
      'weighted-test-0',
      'weighted-test-1'
    ])
  })

  it('keeps public query parameters but strips the API key upstream', () => {
    expect(buildGatewayTargetUrl(
      'http://127.0.0.1:8080/base/',
      '/v1/player',
      '?apikey=secret&API_KEY=second&id=42'
    ).toString()).toBe('http://127.0.0.1:8080/base/v1/player?id=42')
  })

  it('does not allow an upstream path to escape the configured base path', () => {
    expect(() => buildGatewayTargetUrl(
      'https://upstream.example.test/service',
      '/%2e%2e/admin',
      ''
    )).toThrow(/dot segments/)
    expect(() => buildGatewayTargetUrl(
      'https://upstream.example.test/service',
      '/../admin',
      ''
    )).toThrow(/dot segments/)
  })

  it('converts only explicit Service Token rejection into a gateway error', async () => {
    const route = match('service-auth-test', 'round_robin', [1])
    const request = vi.fn().mockResolvedValue(new Response(null, {
      status: 401,
      headers: {
        'x-openapi-error-code': 'UNAUTHORIZED',
        'www-authenticate': 'Service realm="openapi-service"'
      }
    }))
    vi.stubGlobal('fetch', request)
    const proxyFetch = createGatewayProxyFetch({
      match: route,
      targets: route.upstream.targets,
      upstreamPath: '/v1/player',
      search: '',
      maximumResponseBytes: 1024,
      onTarget: vi.fn(),
      onResponseBytes: vi.fn()
    })

    await expect(proxyFetch(new Request('http://gateway.invalid'), {
      headers: { authorization: 'Service wrong-token' }
    })).rejects.toMatchObject({
      status: 502,
      code: 'UPSTREAM_AUTH_FAILED',
      publicMessage: '上游服务认证失败'
    })
  })

  it('ejects a target only after repeated failures, then backs off', async () => {
    const route = match('ejection-test', 'round_robin', [1, 1])
    const [first, second] = route.upstream.targets
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const proxy = proxyFor(route, [first!])

    // One failure is not enough to eject: a single blip keeps the target.
    await expect(proxy(new Request('http://gateway.invalid'))).rejects.toThrow()
    expect(orderedGatewayTargets(route).map(target => target.id))
      .toContain(first!.id)

    // The second consecutive failure ejects it from selection.
    await expect(proxy(new Request('http://gateway.invalid'))).rejects.toThrow()
    expect(orderedGatewayTargets(route).map(target => target.id))
      .toEqual([second!.id])
  })

  it('restores an ejected target once it responds again', async () => {
    const route = match('recovery-test', 'round_robin', [1, 1])
    const [first, second] = route.upstream.targets
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    const failing = proxyFor(route, [first!])
    await expect(failing(new Request('http://gateway.invalid'))).rejects.toThrow()
    await expect(failing(new Request('http://gateway.invalid'))).rejects.toThrow()
    expect(orderedGatewayTargets(route).map(target => target.id))
      .toEqual([second!.id])

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')))
    await proxyFor(route, [first!])(new Request('http://gateway.invalid'))
    expect(orderedGatewayTargets(route).map(target => target.id))
      .toContain(first!.id)
  })

  it('fails over to a healthy target when the first attempt times out', async () => {
    vi.useFakeTimers()
    const route = match('attempt-timeout-test', 'round_robin', [1, 1], 4_000)
    const [first, second] = route.upstream.targets
    // The first target hangs past its attempt slice; the second answers.
    const request = vi.fn()
      .mockImplementationOnce((_url: unknown, init?: RequestInit) => (
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(
            new DOMException('aborted', 'AbortError')
          ))
        })
      ))
      .mockResolvedValueOnce(new Response('recovered'))
    vi.stubGlobal('fetch', request)

    const pending = proxyFor(route)(new Request('http://gateway.invalid'))
    await vi.advanceTimersByTimeAsync(2_000)
    const response = await pending

    await expect(response.text()).resolves.toBe('recovered')
    // Two calls means failover actually happened: before this fix the shared
    // aborted signal killed the retry, so the second target was never tried.
    expect(request).toHaveBeenCalledTimes(2)
    // One timeout is a single failure, below the ejection threshold, so both
    // targets stay selectable while the hung one carries a strike.
    expect(orderedGatewayTargets(route).map(target => target.id).toSorted())
      .toEqual([first!.id, second!.id].toSorted())
  })

  it('does not blame a target when the caller aborts', async () => {
    const route = match('client-abort-test', 'round_robin', [1, 1])
    const [first] = route.upstream.targets
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn().mockImplementation((
      _url: unknown,
      init?: RequestInit
    ) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(
        new DOMException('aborted', 'AbortError')
      ))
    })))

    const pending = proxyFor(route, [first!])(
      new Request('http://gateway.invalid'),
      { signal: controller.signal }
    )
    controller.abort(new Error('client disconnected'))
    await expect(pending).rejects.toThrow()

    // A client hang-up is not the target's fault, so nothing is ejected.
    expect(orderedGatewayTargets(route).map(target => target.id))
      .toContain(first!.id)
  })

  it('preserves an internal business endpoint 401 response', async () => {
    const route = match('business-auth-test', 'round_robin', [1])
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: 'UNAUTHORIZED' }),
      {
        status: 401,
        headers: {
          'content-type': 'application/json',
          'x-openapi-error-code': 'UNAUTHORIZED'
        }
      }
    )))
    const proxyFetch = createGatewayProxyFetch({
      match: route,
      targets: route.upstream.targets,
      upstreamPath: '/v1/private',
      search: '',
      maximumResponseBytes: 1024,
      onTarget: vi.fn(),
      onResponseBytes: vi.fn()
    })

    const response = await proxyFetch(new Request('http://gateway.invalid'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ code: 'UNAUTHORIZED' })
  })
})
