import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSharedCache,
  type SharedCacheClient
} from '~~/server/utils/shared-cache'

interface FakeRedisOptions {
  initial?: Record<string, string>
  canAcquireLock?: boolean
}

function createFakeRedis(options: FakeRedisOptions = {}) {
  const values = new Map(Object.entries(options.initial ?? {}))
  const set = vi.fn(async (key: string, value: string, ...args: Array<string | number>) => {
    if (args.includes('NX') && (values.has(key) || options.canAcquireLock === false)) return null
    values.set(key!, value)
    return 'OK'
  })
  const client: SharedCacheClient = {
    get: vi.fn(async key => values.get(key!) ?? null),
    set,
    del: vi.fn(async (...keys) => {
      let deleted = 0
      for (const key of keys) {
        if (values.delete(key!)) deleted += 1
      }
      return deleted
    }),
    eval: vi.fn(async (script, numberOfKeys, ...parameters) => {
      const [key, generationKey] = parameters.slice(0, numberOfKeys)
      const [token, value, ttl] = parameters.slice(numberOfKeys)
      if (script.includes('-- cache:read')) {
        if (!values.has(generationKey!)) values.set(generationKey!, token!)
        return [values.get(generationKey!), values.get(key!) ?? null]
      }
      if (script.includes('-- cache:write')) {
        if (values.get(generationKey!) !== token) return 0
        await set(key!, value!, 'PX', Number(ttl))
        return 1
      }
      if (script.includes('-- cache:invalidate')) {
        values.set(generationKey!, token!)
        return client.del(key!)
      }
      if (script.includes('redis.call(\'EXISTS\'')) {
        const next = Number(values.get(key!) ?? '1') + 1
        values.set(key!, String(next))
        return next
      }
      if (values.get(key!) !== token) return 0
      values.delete(key!)
      return 1
    })
  }
  return { client, values, set }
}

let cacheSequence = 0

function createTestCache(client: SharedCacheClient | null, overrides: {
  now?: () => number
  random?: () => number
  sleep?: (milliseconds: number) => Promise<void>
} = {}) {
  let token = 0
  const cacheId = ++cacheSequence
  return createSharedCache({
    getClient: () => client,
    getKeyPrefix: () => 'test:',
    now: overrides.now ?? (() => 1_000),
    random: overrides.random ?? (() => 0.5),
    createToken: () => `cache-${cacheId}-token-${++token}`,
    sleep: overrides.sleep ?? (async () => {})
  })
}

describe('shared cache', () => {
  function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(done => { resolve = done })
    return { promise, resolve }
  }

  it.each(['memory', 'redis'] as const)('does not reuse or cache pre-invalidation loads in %s', async (mode) => {
    const cache = createTestCache(mode === 'redis' ? createFakeRedis().client : null)
    const old = deferred<string>()
    const started = deferred<undefined>()
    const first = cache.get({ key: 'item', ttlSeconds: 30, loader: () => { started.resolve(undefined); return old.promise } })
    await started.promise
    await cache.delete(['item'])
    const fresh = vi.fn(async () => 'new')
    await expect(cache.get({ key: 'item', ttlSeconds: 30, loader: fresh })).resolves.toBe('new')
    old.resolve('old')
    await expect(first).resolves.toBe('old')
    await expect(cache.get({ key: 'item', ttlSeconds: 30, loader: fresh })).resolves.toBe('new')
    expect(fresh).toHaveBeenCalledOnce()
  })

  it('rejects stale writes from another cache instance after invalidation', async () => {
    const { client } = createFakeRedis()
    const reader = createTestCache(client)
    const writer = createTestCache(client)
    const old = deferred<string>()
    const started = deferred<undefined>()
    const first = reader.get({ key: 'item', ttlSeconds: 30, loader: () => { started.resolve(undefined); return old.promise } })
    await started.promise
    await writer.delete(['item'])
    const fresh = vi.fn(async () => 'new')
    await writer.get({ key: 'item', ttlSeconds: 30, loader: fresh })
    old.resolve('old')
    await first
    await expect(reader.get({ key: 'item', ttlSeconds: 30, loader: fresh })).resolves.toBe('new')
    expect(fresh).toHaveBeenCalledOnce()
  })

  it('does not join a producer invalidated by another instance', async () => {
    const { client } = createFakeRedis()
    const reader = createTestCache(client)
    const writer = createTestCache(client)
    const old = deferred<string>()
    const started = deferred<undefined>()
    const first = reader.get({ key: 'item', ttlSeconds: 30, loader: () => { started.resolve(undefined); return old.promise } })
    await started.promise
    await writer.delete(['item'])
    await expect(reader.get({ key: 'item', ttlSeconds: 30, loader: async () => 'new' })).resolves.toBe('new')
    old.resolve('old')
    await first
  })

  it('does not revive an invalidated generation after its metadata expires or is evicted', async () => {
    const { client, values } = createFakeRedis()
    const reader = createTestCache(client)
    const writer = createTestCache(client)
    const old = deferred<string>()
    const started = deferred<undefined>()
    const first = reader.get({ key: 'item', ttlSeconds: 30, loader: () => { started.resolve(undefined); return old.promise } })
    await started.promise
    await writer.delete(['item'])
    values.delete('test:item:generation')
    old.resolve('old')
    await first
    expect(values.has('test:item')).toBe(false)
    await expect(writer.get({ key: 'item', ttlSeconds: 30, loader: async () => 'new' })).resolves.toBe('new')
  })

  it('does not let old cleanup remove the new pending producer', async () => {
    const cache = createTestCache(null)
    const old = deferred<string>()
    const started = deferred<undefined>()
    const first = cache.get({ key: 'item', ttlSeconds: 30, loader: () => { started.resolve(undefined); return old.promise } })
    await started.promise
    await cache.delete(['item'])
    const next = deferred<string>()
    const fresh = vi.fn(() => next.promise)
    const second = cache.get({ key: 'item', ttlSeconds: 30, loader: fresh })
    old.resolve('old')
    await first
    const third = cache.get({ key: 'item', ttlSeconds: 30, loader: fresh })
    next.resolve('new')
    expect(await Promise.all([second, third])).toEqual(['new', 'new'])
    expect(fresh).toHaveBeenCalledOnce()
  })

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns a Redis hit without invoking the loader', async () => {
    const { client } = createFakeRedis({ initial: { 'test:cache:item': JSON.stringify({ id: 1 }) } })
    const cache = createTestCache(client)
    const loader = vi.fn(async () => ({ id: 2 }))

    await expect(cache.get({ key: 'cache:item', ttlSeconds: 10, loader })).resolves.toEqual({ id: 1 })
    expect(loader).not.toHaveBeenCalled()
  })

  it('coalesces concurrent misses in one process', async () => {
    const { client } = createFakeRedis()
    const cache = createTestCache(client)
    const loader = vi.fn(async () => ({ id: 1 }))

    const results = await Promise.all([
      cache.get({ key: 'cache:item', ttlSeconds: 10, loader }),
      cache.get({ key: 'cache:item', ttlSeconds: 10, loader })
    ])

    expect(results).toEqual([{ id: 1 }, { id: 1 }])
    expect(loader).toHaveBeenCalledOnce()
  })

  it('lets an aborted caller leave the shared producer running', async () => {
    const cache = createTestCache(null)
    let resolveLoad!: (value: { id: number }) => void
    const loader = vi.fn(() => new Promise<{ id: number }>((resolve) => {
      resolveLoad = resolve
    }))
    const controller = new AbortController()
    const first = cache.get({
      key: 'cache:item',
      ttlSeconds: 10,
      loader,
      signal: controller.signal
    })
    const second = cache.get({ key: 'cache:item', ttlSeconds: 10, loader })

    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })

    resolveLoad({ id: 1 })
    await expect(second).resolves.toEqual({ id: 1 })
    expect(loader).toHaveBeenCalledOnce()
  })

  it('coalesces and caches loads when Redis reads fail', async () => {
    const loader = vi.fn(async () => ({ id: 1 }))
    const client = createFakeRedis().client
    const evaluate = vi.mocked(client.eval).getMockImplementation()!
    vi.mocked(client.eval).mockImplementation(async (...args) => {
      if (args[0].includes('-- cache:read')) throw new Error('offline')
      return evaluate(...args)
    })
    const cache = createTestCache(client)

    await expect(Promise.all([
      cache.get({ key: 'cache:item', ttlSeconds: 10, loader }),
      cache.get({ key: 'cache:item', ttlSeconds: 10, loader })
    ])).resolves.toEqual([{ id: 1 }, { id: 1 }])
    await expect(cache.get({ key: 'cache:item', ttlSeconds: 10, loader })).resolves.toEqual({ id: 1 })
    expect(loader).toHaveBeenCalledOnce()
  })

  it('applies ten percent TTL jitter to Redis writes', async () => {
    const { client, set } = createFakeRedis()
    const cache = createTestCache(client, { random: () => 1 })

    await cache.get({ key: 'cache:item', ttlSeconds: 10, loader: async () => ({ id: 1 }) })

    expect(set).toHaveBeenCalledWith('test:cache:item', JSON.stringify({ id: 1 }), 'PX', 11_000)
  })

  it('deletes Redis and local fallback entries', async () => {
    const client = createFakeRedis().client
    vi.mocked(client.get).mockRejectedValue(new Error('offline'))
    const cache = createTestCache(client)
    const loader = vi.fn(async () => ({ id: 1 }))
    await cache.get({ key: 'cache:item', ttlSeconds: 10, loader })

    await cache.delete(['cache:item'])
    await cache.get({ key: 'cache:item', ttlSeconds: 10, loader })

    expect(client.del).toHaveBeenCalledWith('test:cache:item')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('waits for the lock owner to publish a value', async () => {
    let now = 1_000
    const { client, values } = createFakeRedis({ canAcquireLock: false })
    const cache = createTestCache(client, {
      now: () => now,
      sleep: async () => {
        now += 50
        values.set('test:cache:item', JSON.stringify({ id: 1 }))
      }
    })
    const loader = vi.fn(async () => ({ id: 2 }))

    await expect(cache.get({ key: 'cache:item', ttlSeconds: 10, loader })).resolves.toEqual({ id: 1 })
    expect(loader).not.toHaveBeenCalled()
  })

  it('deletes malformed JSON and reloads a valid value', async () => {
    const { client, values } = createFakeRedis({ initial: { 'test:cache:item': '{broken' } })
    const cache = createTestCache(client)

    await expect(cache.get({
      key: 'cache:item',
      ttlSeconds: 10,
      loader: async () => ({ id: 1 })
    })).resolves.toEqual({ id: 1 })

    expect(JSON.parse(values.get('test:cache:item')!)).toEqual({ id: 1 })
  })

  it('increments a version from an initialized baseline', async () => {
    const { client } = createFakeRedis()
    const cache = createTestCache(client)

    await expect(cache.getVersion('public-apis')).resolves.toBe(1)
    await expect(cache.incrementVersion('public-apis')).resolves.toBe(2)
  })
})
