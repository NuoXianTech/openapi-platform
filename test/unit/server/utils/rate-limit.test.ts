import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RateLimitWindow } from '~~/server/config/api-access'
import { consumeRateLimitWindows } from '~~/server/utils/rate-limit'
import { getMemoryRateLimiter } from '~~/server/utils/rate-limit/memory'

const context = vi.hoisted(() => ({
  client: null as null | { eval: (script: string, keys: number, ...args: string[]) => Promise<unknown> },
  sequence: 0
}))
vi.mock('~~/server/utils/redis', async (original) => ({
  ...await original<typeof import('~~/server/utils/redis')>(),
  getRedisClient: () => context.client,
  getRedisConfig: () => ({ url: `redis://test/${context.sequence}`, keyPrefix: 'test:', required: true })
}))

const secret = '0123456789abcdef0123456789abcdef'
const windows = [
  { window: 'second' as const, limit: 5 },
  { window: 'minute' as const, limit: 20 }
]
let key: string

beforeEach(() => {
  context.client = null
  context.sequence += 1
  key = `route:test-${context.sequence}:apikey:42`
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(61_000)
  vi.stubGlobal('useRuntimeConfig', () => ({ auth: { secret } }))
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('rate limit window consumption', () => {
  it('does not access either adapter when every window is disabled', async () => {
    const evalCommand = vi.fn()
    context.client = { eval: evalCommand }
    const memory = vi.spyOn(getMemoryRateLimiter(), 'consume')
    await expect(consumeRateLimitWindows(key, [
      { window: 'second', limit: 0 }, { window: 'minute', limit: -1 }
    ])).resolves.toEqual({ results: [] })
    expect(evalCommand).not.toHaveBeenCalled()
    expect(memory).not.toHaveBeenCalled()
  })

  it('keeps opaque Redis keys and window alignment when switching between one and multiple windows', async () => {
    const evalCommand = vi.fn<(script: string, keys: number, ...args: string[]) => Promise<unknown>>()
      .mockResolvedValueOnce(1).mockResolvedValueOnce([1, 2, 1]).mockResolvedValueOnce(2)
    context.client = { eval: evalCommand }
    await consumeRateLimitWindows(key, [windows[0]!])
    await expect(consumeRateLimitWindows(key, windows)).resolves.toMatchObject({
      results: [{ remaining: 3, resetAtMs: 62_000 }, { remaining: 19, resetAtMs: 120_000 }]
    })
    await consumeRateLimitWindows(key, [windows[1]!])

    const first = evalCommand.mock.calls[0]!
    const multi = evalCommand.mock.calls[1]!
    const last = evalCommand.mock.calls[2]!
    const digest = (window: RateLimitWindow) => createHmac('sha256', secret)
      .update(`${key}:${window}`).digest('base64url')
    expect(first.slice(1)).toEqual([1, `test:rate-limit:second:61000:${digest('second')}`, '62000'])
    expect(multi.slice(1)).toEqual([
      2, first[2], last[2], '5', '62000', '20', '120000'
    ])
    expect(last[2]).toBe(`test:rate-limit:minute:60000:${digest('minute')}`)
    expect(multi[2]).not.toContain('apikey')
  })

  it('selects the single-window path after ignoring disabled windows', async () => {
    const evalCommand = vi.fn(async () => 1)
    context.client = { eval: evalCommand }
    await expect(consumeRateLimitWindows(key, [
      { window: 'second', limit: 0 }, { window: 'minute', limit: 1 }
    ])).resolves.toMatchObject({ results: [{ allowed: true, window: 'minute', remaining: 0 }] })
    expect(evalCommand.mock.calls[0]?.[1]).toBe(1)
  })

  it('allows a multi-window consumption that reaches the limit and identifies the first denied window', async () => {
    const evalCommand = vi.fn().mockResolvedValueOnce([1, 5, 2]).mockResolvedValueOnce([0, 5, 2])
    context.client = { eval: evalCommand }
    await expect(consumeRateLimitWindows(key, windows)).resolves.toMatchObject({
      results: [{ allowed: true, remaining: 0 }, { allowed: true, remaining: 18 }]
    })
    await expect(consumeRateLimitWindows(key, windows)).resolves.toEqual({
      denied: { allowed: false, remaining: 0, resetAtMs: 62_000, limit: 5, window: 'second' }
    })
  })

  it.each([1, 2])('never retries an ambiguous Redis failure for %i window(s)', async (count) => {
    const evalCommand = vi.fn(async () => { throw new Error('reply lost after consumption') })
    context.client = { eval: evalCommand }
    const memory = vi.spyOn(getMemoryRateLimiter(), 'consume')
    await expect(consumeRateLimitWindows(key, windows.slice(0, count))).rejects.toMatchObject({
      code: 'REDIS_UNAVAILABLE', statusCode: 503
    })
    expect(evalCommand).toHaveBeenCalledOnce()
    expect(memory).not.toHaveBeenCalled()
  })

  it.each([[1, 1], [2, 1, 1], [1, -1, 1]])('rejects malformed multi-window results without another consume: %j', async (...reply) => {
    const evalCommand = vi.fn(async () => reply)
    context.client = { eval: evalCommand }
    await expect(consumeRateLimitWindows(key, windows)).rejects.toMatchObject({ code: 'REDIS_UNAVAILABLE' })
    expect(evalCommand).toHaveBeenCalledOnce()
  })

  it('preserves sequential memory consumption, subject isolation and fixed-window resets', async () => {
    const limits = [{ window: 'second' as const, limit: 2 }, { window: 'minute' as const, limit: 1 }]
    await expect(consumeRateLimitWindows(key, limits)).resolves.toMatchObject({
      results: [{ remaining: 1 }, { remaining: 0 }]
    })
    // The second request consumes the second window before the minute window denies it.
    await expect(consumeRateLimitWindows(key, limits)).resolves.toMatchObject({ denied: { window: 'minute' } })
    await expect(consumeRateLimitWindows(key, limits)).resolves.toMatchObject({ denied: { window: 'second' } })
    await expect(consumeRateLimitWindows(`${key}:other`, limits)).resolves.toHaveProperty('results')
    vi.setSystemTime(62_000)
    await expect(consumeRateLimitWindows(key, limits)).resolves.toMatchObject({ denied: { window: 'minute' } })
    vi.setSystemTime(120_000)
    await expect(consumeRateLimitWindows(key, limits)).resolves.toMatchObject({
      results: [{ remaining: 1, resetAtMs: 121_000 }, { remaining: 0, resetAtMs: 180_000 }]
    })
  })
})
