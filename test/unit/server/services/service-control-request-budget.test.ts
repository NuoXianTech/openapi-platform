import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceDescription } from '#shared/types/service-control'
import { readServiceTargetContract } from '~~/server/services/service-target-contract'
import { resolveServiceAvailability } from '~~/server/services/service-availability-service'
import { serviceControlClient } from '~~/server/utils/service-control-client'
import type { fetchUpstreamTarget } from '~~/server/utils/upstream-target-fetch'
import { canonicalJson } from '~~/server/utils/canonical-json'

const transport = vi.hoisted(() => vi.fn<typeof fetchUpstreamTarget>())
vi.mock('~~/server/utils/upstream-target-fetch', () => ({ fetchUpstreamTarget: transport }))

const definition = { schemaVersion: 1, groups: [] }
const schemaSha256 = createHash('sha256').update(canonicalJson(definition)).digest('hex')
const description: ServiceDescription = {
  schemaVersion: 1, serviceProtocol: 'openapi-service/v1', serviceId: 'budget-test',
  name: 'Budget', version: '1', commit: 'test', openapi: '/openapi.json', openapiSha256: 'a'.repeat(64),
  health: '/healthz', readiness: '/readyz', configuration: { schema: '/schema', state: '/state', update: '/config', schemaSha256 }
}
const state = {
  schemaVersion: 1, serviceId: description.serviceId, schemaSha256, revision: 1,
  configurationSha256: 'b'.repeat(64), values: {}, updatedAt: '2026-10-08T00:00:00.000Z'
}
const token = 'test-control-token'

afterEach(() => { transport.mockReset(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('Service control request budgets through caller interfaces', () => {
  it('shares control capacity across contract reads and writes while reserving probe capacity through body cancellation', async () => {
    const gates = { control: Promise.withResolvers<undefined>(), probe: Promise.withResolvers<undefined>() }
    const active = { control: 0, probe: 0 }
    const peak = { control: 0, probe: 0, total: 0 }
    let controlRequests = 0
    transport.mockImplementation(async (input) => {
      const url = new URL(input)
      const kind = url.pathname.startsWith('/probe/') ? 'probe' : 'control'
      if (kind === 'control') controlRequests += 1
      active[kind] += 1
      peak[kind] = Math.max(peak[kind], active[kind])
      peak.total = Math.max(peak.total, active.control + active.probe)
      const data = url.pathname.endsWith('/.well-known/service.json') ? description
        : url.pathname.endsWith('/schema') ? definition : state
      let finished = false
      const finish = () => { if (!finished) { finished = true; active[kind] -= 1 } }
      return new Response(new ReadableStream<Uint8Array>({
        async pull(controller) {
          await gates[kind].promise
          controller.enqueue(new TextEncoder().encode(JSON.stringify(data)))
          controller.close()
          finish()
        },
        async cancel() { await gates[kind].promise; finish() }
      }, { highWaterMark: 0 }), {
        headers: { 'x-openapi-sha256': description.openapiSha256, 'x-configuration-schema-sha256': schemaSha256 }
      })
    })
    const control = Array.from({ length: 32 }, (_, index) => index % 2 === 0
      ? readServiceTargetContract(`http://target.test/control/${index}`, token)
      : serviceControlClient.updateConfiguration(`http://target.test/control/${index}`, '/config', token, { revision: 1, values: {} }))
    const probes = Array.from({ length: 32 }, (_, index) => resolveServiceAvailability(description, [
      { id: String(index), baseUrl: `http://target.test/probe/${index}`, enabled: true }
    ], token))
    try {
      expect(active).toEqual({ control: 16, probe: 16 })
      gates.probe.resolve(undefined)
      expect((await Promise.all(probes)).every(result => result.overall === 'online')).toBe(true)
      // Headers have arrived, but unread control bodies still own all 16 permits.
      expect(controlRequests).toBe(16)
      expect(active).toEqual({ control: 16, probe: 0 })
      gates.control.resolve(undefined)
      const results = await Promise.all(control)
      expect(results).toHaveLength(32)
      expect(controlRequests).toBe(64)
      expect(peak).toEqual({ control: 16, probe: 16, total: 32 })
      expect(active).toEqual({ control: 0, probe: 0 })
    } finally {
      gates.control.resolve(undefined)
      gates.probe.resolve(undefined)
      await Promise.allSettled([...control, ...probes])
    }
  })

  it.each(['network', 'http', 'json', 'schema', 'size', 'body'] as const)('releases control capacity after %s failures so queued requests finish', async (failure) => {
    let requests = 0
    const cancel = vi.fn()
    transport.mockImplementation(async () => {
      if (requests++ >= 16) return Response.json(description)
      if (failure === 'network') throw new Error('offline')
      if (failure === 'http') return Response.json({ code: 'FAILED', message: 'unavailable' }, { status: 503 })
      if (failure === 'json') return new Response('{')
      if (failure === 'schema') return Response.json({ serviceProtocol: 'openapi-service/v1' })
      if (failure === 'body') return new Response(new ReadableStream({ start(controller) { controller.error(new Error('broken body')) } }))
      return new Response(new ReadableStream({ cancel }), { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } })
    })
    const results = await Promise.allSettled(Array.from({ length: 32 }, (_, index) => (
      serviceControlClient.getDescription(`http://target.test/${index}`, token)
    )))
    expect(results.slice(0, 16).every(result => result.status === 'rejected')).toBe(true)
    expect(results.slice(16).every(result => result.status === 'fulfilled')).toBe(true)
    expect(transport).toHaveBeenCalledTimes(32)
    if (failure === 'size') expect(cancel).toHaveBeenCalledTimes(16)
  })

  it.each([
    { kind: 'control', timeoutMs: 10_000 },
    { kind: 'probe', timeoutMs: 1_500 }
  ])('starts the $kind network deadline after admission and releases timed-out requests', async ({ kind, timeoutMs }) => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    transport.mockImplementation((_input, init) => new Promise((_resolve, reject) => {
      const signal = init!.signal!
      signals.push(signal)
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))
    const pending = Promise.allSettled(Array.from({ length: 17 }, (_, index) => kind === 'control'
      ? serviceControlClient.getDescription(`http://target.test/${index}`, token)
      : serviceControlClient.checkAvailability(`http://target.test/${index}`, '/readyz', '/state', token)))
    try {
      expect(signals).toHaveLength(16)
      await vi.advanceTimersByTimeAsync(timeoutMs)
      expect(signals).toHaveLength(17)
      expect(signals[16]!.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(timeoutMs - 1)
      expect(signals[16]!.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(signals.every(signal => signal.aborted)).toBe(true)
      const results = await pending
      if (kind === 'control') expect(results.every(result => result.status === 'rejected')).toBe(true)
      else expect(results.every(result => result.status === 'fulfilled' && result.value === false)).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await vi.runAllTimersAsync()
      await pending
    }
  })

  it('keeps the control deadline active after headers and releases stalled bodies for queued work', async () => {
    vi.useFakeTimers()
    let requests = 0
    transport.mockImplementation(async (_input, init) => {
      if (requests++ >= 16) return Response.json(description)
      const signal = init!.signal!
      return new Response(new ReadableStream({
        start(controller) { signal.addEventListener('abort', () => controller.error(signal.reason), { once: true }) }
      }))
    })
    const pending = Promise.allSettled(Array.from({ length: 17 }, (_, index) => (
      serviceControlClient.getDescription(`http://target.test/${index}`, token)
    )))
    try {
      await vi.advanceTimersByTimeAsync(9_999)
      expect(transport).toHaveBeenCalledTimes(16)
      await vi.advanceTimersByTimeAsync(1)
      const results = await pending
      expect(results.slice(0, 16).every(result => result.status === 'rejected')).toBe(true)
      expect(results[16]).toMatchObject({ status: 'fulfilled', value: { data: description } })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      await vi.runAllTimersAsync()
      await pending
    }
  })
})
