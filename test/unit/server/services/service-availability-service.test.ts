import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceDescription } from '#shared/types/service-control'
import { resolveServiceAvailability } from '~~/server/services/service-availability-service'

vi.mock('~~/server/utils/safe-fetch', () => ({
  safeFetch: (input: RequestInfo | URL, init?: RequestInit) => (
    globalThis.fetch(input, init)
  )
}))

const description: ServiceDescription = {
  schemaVersion: 1,
  serviceId: 'availability-test',
  name: 'Availability test',
  version: '0.1.0',
  commit: 'test',
  openapi: '/openapi.json',
  openapiSha256: 'a'.repeat(64),
  health: '/healthz',
  readiness: '/readyz',
  configuration: {
    schema: '/.well-known/configuration/schema.json',
    state: '/.well-known/configuration/state.json',
    update: '/.well-known/configuration',
    schemaSha256: 'b'.repeat(64)
  },
  serviceProtocol: 'openapi-service/v1'
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('service availability service', () => {
  it('shares the probe budget across upstream reads and releases failed probes for queued work', async () => {
    let active = 0
    let peak = 0
    const saturated = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const request = vi.fn(async (input: string | URL | Request) => {
      active += 1
      peak = Math.max(peak, active)
      if (active === 16) saturated.resolve(undefined)
      try {
        await release.promise
        if (new URL(input.toString()).port === '9000') throw new Error('offline')
        return new Response(null, { status: 200 })
      } finally {
        active -= 1
      }
    })
    vi.stubGlobal('fetch', request)
    const targets = Array.from({ length: 40 }, (_, index) => ({
      id: `target-${index}`, baseUrl: `http://127.0.0.1:${9000 + index}`, enabled: true
    }))
    const pending = Promise.all(targets.map(target => resolveServiceAvailability(description, [target], 'service-token')))
    await saturated.promise
    release.resolve(undefined)
    const results = await pending
    expect(peak).toBeLessThanOrEqual(16)
    expect(peak).toBeGreaterThan(1)
    expect(results.map(result => result.overall)).toEqual(['offline', ...Array<string>(39).fill('online')])
    expect(active).toBe(0)
    expect(request).toHaveBeenCalledTimes(79)
  })

  it('returns unknown without a discovered contract or enabled Target', async () => {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)

    await expect(resolveServiceAvailability(null, [
      { id: 'target-1', baseUrl: 'http://127.0.0.1:8100', enabled: true }
    ], 'service-token')).resolves.toMatchObject({ overall: 'unknown' })
    await expect(resolveServiceAvailability(description, [
      { id: 'target-1', baseUrl: 'http://127.0.0.1:8100', enabled: false }
    ], 'service-token')).resolves.toMatchObject({ overall: 'unknown' })
    await expect(resolveServiceAvailability(description, [
      { id: 'target-1', baseUrl: 'http://127.0.0.1:8100', enabled: true }
    ], null)).resolves.toMatchObject({ overall: 'unknown' })
    expect(request).not.toHaveBeenCalled()
  })

  it('aggregates readiness across every enabled Target', async () => {
    const request = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input.toString())
      if (url.port === '8202' || url.port === '8302') {
        return new Response(null, { status: 503 })
      }
      if (url.port === '8301') throw new Error('connection refused')
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', request)

    await expect(resolveServiceAvailability(description, [
      { id: 'target-1', baseUrl: 'http://127.0.0.1:8101', enabled: true },
      { id: 'target-2', baseUrl: 'http://127.0.0.1:8102', enabled: true }
    ], 'service-token')).resolves.toMatchObject({ overall: 'online' })
    await expect(resolveServiceAvailability(description, [
      { id: 'target-1', baseUrl: 'http://127.0.0.1:8201', enabled: true },
      { id: 'target-2', baseUrl: 'http://127.0.0.1:8202', enabled: true }
    ], 'service-token')).resolves.toEqual({
      overall: 'degraded',
      targets: new Map([
        ['target-1', 'online'],
        ['target-2', 'offline']
      ])
    })
    await expect(resolveServiceAvailability(description, [
      { id: 'target-1', baseUrl: 'http://127.0.0.1:8301', enabled: true },
      { id: 'target-2', baseUrl: 'http://127.0.0.1:8302', enabled: true }
    ], 'service-token')).resolves.toMatchObject({ overall: 'offline' })
  })

  it('deduplicates concurrent Target readiness requests', async () => {
    const release = Promise.withResolvers<undefined>()
    const request = vi.fn(async () => {
      await release.promise
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', request)
    const targets = [{
      id: 'target-1',
      baseUrl: 'http://127.0.0.1:8400/service',
      enabled: true
    }]

    const first = resolveServiceAvailability(
      description,
      targets,
      'service-token'
    )
    const second = resolveServiceAvailability(
      description,
      targets,
      'service-token'
    )
    release.resolve(undefined)

    await expect(Promise.all([first, second]))
      .resolves.toEqual([
        {
          overall: 'online',
          targets: new Map([['target-1', 'online']])
        },
        {
          overall: 'online',
          targets: new Map([['target-1', 'online']])
        }
      ])

    expect(request).toHaveBeenCalledTimes(2)
    expect(request.mock.calls[0]?.[0].toString())
      .toBe('http://127.0.0.1:8400/service/readyz')
    expect(request.mock.calls[1]?.[0].toString())
      .toBe('http://127.0.0.1:8400/service/.well-known/configuration/state.json')
    expect(new Headers(request.mock.calls[1]?.[1]?.headers).get('authorization'))
      .toBe('Service service-token')
  })

  it('does not report a ready Target as online when Service authentication fails', async () => {
    const request = vi.fn(async (input: string | URL | Request) => (
      input.toString().endsWith('/readyz')
        ? new Response(null, { status: 200 })
        : new Response(null, { status: 401 })
    ))
    vi.stubGlobal('fetch', request)

    await expect(resolveServiceAvailability(description, [{
      id: 'target-1',
      baseUrl: 'http://127.0.0.1:8500',
      enabled: true
    }], 'wrong-service-token')).resolves.toMatchObject({ overall: 'offline' })
  })
})
