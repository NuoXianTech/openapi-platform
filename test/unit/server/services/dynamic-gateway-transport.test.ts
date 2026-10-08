import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forwardGatewayRequest } from '~~/server/services/dynamic-gateway-transport'
import { gatewayTargetHealth } from '~~/server/services/gateway-target-health'
import type { fetchUpstreamTarget } from '~~/server/utils/upstream-target-fetch'
import { createGatewayMatch } from '../../../helpers/gateway-match'

const mocks = vi.hoisted(() => ({
  request: vi.fn<typeof fetchUpstreamTarget>(),
  inspectSignal: vi.fn<(signal: AbortSignal) => void>()
}))
vi.mock('~~/server/utils/upstream-target-fetch', () => ({ fetchUpstreamTarget: mocks.request }))
vi.mock('~~/server/utils/redis', () => ({ getRedisClient: () => null, getRedisConfig: () => ({ keyPrefix: 'test:' }) }))
vi.mock('h3', async (original) => {
  const h3 = await original<typeof import('h3')>()
  return {
    ...h3,
    sendProxy: (...args: Parameters<typeof h3.sendProxy>) => {
      // Observe the outgoing H3 adapter, retaining its real body consumption.
      mocks.inspectSignal(args[2]!.fetchOptions!.signal!)
      return h3.sendProxy(...args)
    }
  }
})

function event() {
  const request = new IncomingMessage(new Socket())
  request.method = 'GET'
  request.url = '/v1/stream'
  request.headers.host = 'gateway.test'
  return createEvent(request, new ServerResponse(request))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.request.mockReset()
  mocks.inspectSignal.mockImplementation(signal => {
    vi.spyOn(signal, 'addEventListener')
    vi.spyOn(signal, 'removeEventListener')
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('complete Gateway transfer cleanup', () => {
  it.each(['request', 'response'] as const)('does not dispatch or blame a Target when the %s was already disconnected', async (disconnected) => {
    const incoming = event()
    if (disconnected === 'request') incoming.node.req.aborted = true
    else incoming.node.res.destroy()
    const health = vi.spyOn(gatewayTargetHealth, 'report')
    await expect(forwardGatewayRequest(incoming, createGatewayMatch(), new Headers(), vi.fn()))
      .rejects.toMatchObject({ status: 499, code: 'CLIENT_DISCONNECTED' })
    expect(mocks.request).not.toHaveBeenCalled()
    expect(health).not.toHaveBeenCalled()
    expect(incoming.node.req.listenerCount('aborted')).toBe(0)
    expect(incoming.node.res.listenerCount('close')).toBe(0)
  })

  it('does not retry or blame a Target when the client disconnects before headers arrive', async () => {
    const incoming = event()
    const started = Promise.withResolvers<undefined>()
    mocks.request.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('client disconnected')), { once: true })
      started.resolve(undefined)
    }))
    const match = createGatewayMatch()
    match.upstream.targets.push({ id: 'replacement', baseUrl: 'http://127.0.0.1:8081', weight: 1 })
    const health = vi.spyOn(gatewayTargetHealth, 'report')
    const rejected = expect(forwardGatewayRequest(incoming, match, new Headers(), vi.fn()))
      .rejects.toMatchObject({ status: 499, code: 'CLIENT_DISCONNECTED' })
    await started.promise
    incoming.node.req.emit('aborted')
    await rejected
    expect(mocks.request).toHaveBeenCalledOnce()
    expect(health).not.toHaveBeenCalled()
    expect(incoming.node.req.listenerCount('aborted')).toBe(0)
    expect(incoming.node.res.listenerCount('close')).toBe(0)
  })

  it.each(['close', 'error', 'cancel'] as const)('releases the final attempt abort listener exactly once when the body ends with %s', async (ending) => {
    const incoming = event()
    let source!: ReadableStreamDefaultController<Uint8Array>
    const cancel = vi.fn()
    mocks.request.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) { source = controller; controller.enqueue(new Uint8Array([1])) },
      cancel
    })))
    const firstChunk = Promise.withResolvers<undefined>()
    const write = vi.spyOn(incoming.node.res, 'write').mockImplementation(() => { firstChunk.resolve(undefined); return true })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = forwardGatewayRequest(incoming, createGatewayMatch(), new Headers(), vi.fn())
      .then(() => null, error => error)
    await firstChunk.promise
    const signal = mocks.inspectSignal.mock.calls[0]![0]
    const add = vi.mocked(signal.addEventListener)
    const remove = vi.mocked(signal.removeEventListener)
    const listener = add.mock.calls.find(call => call[0] === 'abort')![1]
    expect(remove).not.toHaveBeenCalledWith('abort', listener)
    if (ending === 'close') source.close()
    if (ending === 'error') source.error(new Error('broken stream'))
    if (ending === 'cancel') {
      write.mockImplementationOnce(() => { throw new Error('downstream write failed') })
      source.enqueue(new Uint8Array([2]))
    }
    const error = await result
    if (ending === 'close') expect(error).toBeNull()
    else expect(error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' })
    if (ending === 'cancel') expect(cancel).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledExactlyOnceWith('abort', listener)
    expect(incoming.node.req.listenerCount('aborted')).toBe(0)
    expect(incoming.node.res.listenerCount('close')).toBe(0)
  })
})
