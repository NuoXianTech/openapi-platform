import { randomUUID } from 'node:crypto'
import { getRedisClient, getRedisConfig } from '~~/server/utils/redis'

export interface SharedCacheClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: Array<string | number>): Promise<unknown>
  del(...keys: string[]): Promise<number>
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>
}

export interface SharedCacheOptions<TValue> {
  key: string
  ttlSeconds: number
  loader: () => Promise<TValue>
  signal?: AbortSignal
}

export interface SharedCacheDependencies {
  getClient: () => SharedCacheClient | null
  getKeyPrefix: () => string
  now: () => number
  random: () => number
  createToken: () => string
  sleep: (milliseconds: number) => Promise<void>
}

interface CacheEntry {
  value: unknown
  expiresAt: number
}

interface CacheResult<TValue> {
  hit: boolean
  value?: TValue
}

interface PendingLoad {
  generation: string | null
  promise: Promise<unknown>
}

// Read the value and its generation together so invalidation cannot split them.
const READ_CACHE_SCRIPT = `
-- cache:read
local generation = redis.call('GET', KEYS[2])
if not generation then
  generation = ARGV[1]
  redis.call('SET', KEYS[2], generation, 'PX', ARGV[2])
end
return {generation, redis.call('GET', KEYS[1]) or false}
`
const WRITE_CACHE_SCRIPT = `
-- cache:write
if redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 1
`
const INVALIDATE_CACHE_SCRIPT = `
-- cache:invalidate
redis.call('SET', KEYS[2], ARGV[1], 'PX', ARGV[2])
return redis.call('DEL', KEYS[1])
`

const LOCK_TTL_MS = 10_000
const LOCK_WAIT_MS = 500
const LOCK_POLL_MS = 50
const MAX_MEMORY_ENTRIES = 500
const TTL_JITTER_RATIO = 0.1
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`
const INCREMENT_VERSION_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('INCR', KEYS[1])
end
redis.call('SET', KEYS[1], 2)
return 2
`

function createAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

export async function waitForAbort<TValue>(promise: Promise<TValue>, signal?: AbortSignal): Promise<TValue> {
  if (!signal) return promise
  if (signal.aborted) throw createAbortError(signal)

  return new Promise<TValue>((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      reject(createAbortError(signal))
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
  })
}

export function createSharedCache(
  dependencies: Partial<SharedCacheDependencies> = {}
) {
  const resolvedDependencies: SharedCacheDependencies = {
    getClient: () => getRedisClient() as unknown as SharedCacheClient | null,
    getKeyPrefix: () => getRedisConfig().keyPrefix,
    now: Date.now,
    random: Math.random,
    createToken: randomUUID,
    sleep: milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    ...dependencies
  }
  const memory = new Map<string, CacheEntry>()
  const pendingLoads = new Map<string, PendingLoad>()
  const localVersions = new Map<string, number>()
  const loggedFailures = new Set<string>()

  function toFullKey(key: string): string {
    const prefix = resolvedDependencies.getKeyPrefix()
    return `${prefix.endsWith(':') ? prefix : `${prefix}:`}${key}`
  }

  function warnOnce(operation: string, error: unknown): void {
    if (loggedFailures.has(operation)) return
    loggedFailures.add(operation)
    console.warn('[shared-cache] Redis unavailable; using database or memory fallback', {
      operation,
      error: error instanceof Error ? error.message : String(error)
    })
  }

  function createTtlMs(ttlSeconds: number): number {
    const random = Math.min(Math.max(resolvedDependencies.random(), 0), 1)
    const multiplier = 1 - TTL_JITTER_RATIO + random * TTL_JITTER_RATIO * 2
    return Math.max(1, Math.round(ttlSeconds * 1_000 * multiplier))
  }

  function readMemory<TValue>(key: string): CacheResult<TValue> {
    const entry = memory.get(key)
    if (!entry) return { hit: false }
    if (entry.expiresAt <= resolvedDependencies.now()) {
      memory.delete(key)
      return { hit: false }
    }
    return { hit: true, value: entry.value as TValue }
  }

  function writeMemory<TValue>(key: string, value: TValue, ttlMs: number): void {
    if (memory.size >= MAX_MEMORY_ENTRIES) {
      const now = resolvedDependencies.now()
      for (const [entryKey, entry] of memory) {
        if (entry.expiresAt <= now) memory.delete(entryKey)
      }
      while (memory.size >= MAX_MEMORY_ENTRIES) {
        const oldestKey = memory.keys().next().value as string | undefined
        if (!oldestKey) break
        memory.delete(oldestKey)
      }
    }
    memory.set(key, { value, expiresAt: resolvedDependencies.now() + ttlMs })
  }

  async function readRedis<TValue>(client: SharedCacheClient, key: string, ttlMs: number): Promise<CacheResult<TValue> & { generation: string }> {
    const result = await client.eval(READ_CACHE_SCRIPT, 2, key, `${key}:generation`, resolvedDependencies.createToken(), String(ttlMs + LOCK_TTL_MS))
    if (!Array.isArray(result) || typeof result[0] !== 'string') throw new Error('Invalid Redis cache response')
    const [generation, serialized] = result as [string, string | null]
    if (serialized === null) return { hit: false, generation }
    try {
      return { hit: true, generation, value: JSON.parse(serialized) as TValue }
    } catch (error) {
      warnOnce('parse', error)
      // A newer value may have replaced the corrupt one after the atomic read.
      await client.eval(RELEASE_LOCK_SCRIPT, 1, key, serialized).catch(deleteError => warnOnce('delete-corrupt', deleteError))
      return { hit: false, generation }
    }
  }

  async function loadSource<TValue>(
    key: string,
    ttlMs: number,
    loader: () => Promise<TValue>,
    isCurrent: () => boolean,
    client: SharedCacheClient | null,
    generation = ''
  ): Promise<TValue> {
    const value = await loader()
    // Existing callers may finish with their old result, but cannot cache it.
    if (!isCurrent()) return value
    if (client) {
      try {
        const serialized = JSON.stringify(value)
        if (serialized !== undefined) {
          await client.eval(WRITE_CACHE_SCRIPT, 2, key, `${key}:generation`, generation, serialized, String(ttlMs), String(ttlMs + LOCK_TTL_MS))
          return value
        }
      } catch (error) {
        warnOnce('write', error)
      }
    }
    if (isCurrent()) writeMemory(key, value, ttlMs)
    return value
  }

  async function loadMemory<TValue>(
    key: string, ttlMs: number, loader: () => Promise<TValue>, isCurrent: () => boolean
  ): Promise<TValue> {
    const cached = readMemory<TValue>(key)
    return cached.hit ? cached.value as TValue : loadSource(key, ttlMs, loader, isCurrent, null)
  }

  async function loadRedis<TValue>(
    client: SharedCacheClient, key: string, generation: string,
    ttlMs: number, loader: () => Promise<TValue>, isCurrent: () => boolean
  ): Promise<TValue> {
    // A producer from an invalidated generation must not block the new one.
    const lockKey = `${key}:lock:${generation || 'initial'}`
    const token = resolvedDependencies.createToken()
    let isLockOwner: boolean
    try {
      isLockOwner = await client.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX') === 'OK'
    } catch (error) {
      warnOnce('lock', error)
      return loadMemory(key, ttlMs, loader, isCurrent)
    }
    if (!isLockOwner) {
      const deadline = resolvedDependencies.now() + LOCK_WAIT_MS
      while (resolvedDependencies.now() < deadline) {
        await resolvedDependencies.sleep(LOCK_POLL_MS)
        try {
          const cached = await readRedis<TValue>(client, key, ttlMs)
          if (cached.hit) return cached.value as TValue
          if (cached.generation !== generation) break
        } catch (error) {
          warnOnce('wait-read', error)
          return loadMemory(key, ttlMs, loader, isCurrent)
        }
      }
      return loadSource(key, ttlMs, loader, isCurrent, client, generation)
    }
    try {
      return await loadSource(key, ttlMs, loader, isCurrent, client, generation)
    } finally {
      await client.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token)
        .catch(error => warnOnce('unlock', error))
    }
  }

  async function coalesce<TValue>(
    key: string, generation: string | null, loader: (isCurrent: () => boolean) => Promise<TValue>
  ): Promise<TValue> {
    const existing = pendingLoads.get(key)
    if (existing && existing.generation === generation) return existing.promise as Promise<TValue>
    const pending: PendingLoad = {
      generation,
      // Register ownership before invoking even a synchronously resolving loader.
      promise: Promise.resolve().then(() => loader(() => pendingLoads.get(key) === pending))
    }
    pendingLoads.set(key, pending)
    try {
      return await pending.promise as TValue
    } finally {
      if (pendingLoads.get(key) === pending) pendingLoads.delete(key)
    }
  }

  async function get<TValue>(options: SharedCacheOptions<TValue>): Promise<TValue> {
    const load = async (): Promise<TValue> => {
      const key = toFullKey(options.key)
      const ttlMs = createTtlMs(options.ttlSeconds)
      let client: SharedCacheClient | null
      try {
        client = resolvedDependencies.getClient()
      } catch (error) {
        warnOnce('client', error)
        client = null
      }
      if (!client) return coalesce(key, null, current => loadMemory(key, ttlMs, options.loader, current))
      let generation: string
      try {
        const cached = await readRedis<TValue>(client, key, ttlMs)
        // A recovered Redis read supersedes any fallback from its outage.
        memory.delete(key)
        if (cached.hit) return cached.value as TValue
        generation = cached.generation
      } catch (error) {
        warnOnce('read', error)
        return coalesce(key, null, current => loadMemory(key, ttlMs, options.loader, current))
      }
      const redis = client
      return coalesce(key, generation, current => loadRedis(redis, key, generation, ttlMs, options.loader, current))
    }
    return waitForAbort(load(), options.signal)
  }

  async function deleteKeys(keys: string[]): Promise<void> {
    const fullKeys = keys.map(toFullKey)
    for (const key of fullKeys) {
      memory.delete(key)
      pendingLoads.delete(key)
    }
    if (fullKeys.length === 0) return
    try {
      const client = resolvedDependencies.getClient()
      if (client) await Promise.all(fullKeys.map(key => client.eval(
        INVALIDATE_CACHE_SCRIPT, 2, key, `${key}:generation`, resolvedDependencies.createToken(), String(LOCK_TTL_MS)
      )))
    } catch (error) {
      warnOnce('delete', error)
    }
  }

  async function getVersion(namespace: string): Promise<number> {
    const key = toFullKey(`cache:version:${namespace}`)
    try {
      const client = resolvedDependencies.getClient()
      if (!client) return localVersions.get(key) ?? 1
      const current = Number(await client.get(key))
      if (Number.isSafeInteger(current) && current > 0) return current
      if (await client.set(key, '1', 'NX') === 'OK') return 1
      const initialized = Number(await client.get(key))
      return Number.isSafeInteger(initialized) && initialized > 0 ? initialized : 1
    } catch (error) {
      warnOnce('version-read', error)
      return localVersions.get(key) ?? 1
    }
  }

  async function incrementVersion(namespace: string): Promise<number> {
    const key = toFullKey(`cache:version:${namespace}`)
    const localVersion = (localVersions.get(key) ?? 1) + 1
    localVersions.set(key, localVersion)
    try {
      const client = resolvedDependencies.getClient()
      if (!client) return localVersion
      const version = Number(await client.eval(INCREMENT_VERSION_SCRIPT, 1, key))
      return Number.isSafeInteger(version) && version > 0 ? version : localVersion
    } catch (error) {
      warnOnce('version-increment', error)
      return localVersion
    }
  }

  return { get, delete: deleteKeys, getVersion, incrementVersion }
}

const sharedCache = createSharedCache()

export function getSharedCache<TValue>(options: SharedCacheOptions<TValue>): Promise<TValue> {
  return sharedCache.get(options)
}

export function deleteSharedCache(keys: string[]): Promise<void> {
  return sharedCache.delete(keys)
}

export function getSharedCacheVersion(namespace: string): Promise<number> {
  return sharedCache.getVersion(namespace)
}

export function incrementSharedCacheVersion(namespace: string): Promise<number> {
  return sharedCache.incrementVersion(namespace)
}
