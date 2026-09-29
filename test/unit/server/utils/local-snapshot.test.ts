import { describe, expect, it, vi } from 'vitest'
import { createLocalSnapshot } from '~~/server/utils/local-snapshot'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

describe('process-local snapshots', () => {
  it('coalesces reads and prevents an old load from overwriting an explicit replacement', async () => {
    const old = deferred<string>()
    const load = vi.fn(() => old.promise)
    const cache = createLocalSnapshot({ ttlMs: 1000, maxEntries: 1, load })
    const first = cache.get('key')
    expect(cache.get('key')).toBe(first)
    await Promise.resolve()
    cache.replace('key', 'saved')
    old.resolve('old')
    await expect(first).resolves.toBe('old')
    await expect(cache.get('key')).resolves.toBe('saved')
    expect(load).toHaveBeenCalledOnce()
  })

  it.each(['resolve', 'reject'] as const)('does not join or clean up a new producer when an invalidated read finishes via %s', async (outcome) => {
    const old = deferred<string>()
    const fresh = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const cache = createLocalSnapshot<string, string>({ ttlMs: 1000, maxEntries: 1, load })
    const first = cache.get('key')
    const finished = first.catch(() => 'failed')
    await Promise.resolve()
    cache.invalidate('key')
    const second = cache.get('key')
    await Promise.resolve()
    if (outcome === 'resolve') old.resolve('old')
    else old.reject(new Error('old failure'))
    await finished
    expect(cache.get('key')).toBe(second)
    fresh.resolve('new')
    await expect(second).resolves.toBe('new')
    await expect(cache.get('key')).resolves.toBe('new')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('clear detaches all old producers even when their keys are reused', async () => {
    const old = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue('new')
    const cache = createLocalSnapshot<string, string>({ ttlMs: 1000, maxEntries: 2, load })
    const first = cache.get('key')
    await Promise.resolve()
    cache.clear()
    await expect(cache.get('key')).resolves.toBe('new')
    old.resolve('old')
    await first
    await expect(cache.get('key')).resolves.toBe('new')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('evicted in-flight reads cannot refill the bounded cache', async () => {
    const old = deferred<string>()
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue('fresh')
    const cache = createLocalSnapshot<string, string>({ ttlMs: 1000, maxEntries: 1, load })
    const first = cache.get('a')
    await Promise.resolve()
    await cache.get('b')
    old.resolve('old')
    await first
    await expect(cache.get('a')).resolves.toBe('fresh')
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('passes stale values to domain loaders without treating null as a cache miss', async () => {
    let now = 0
    const load = vi.fn().mockResolvedValue(null)
    const cache = createLocalSnapshot<string, string | null>({ ttlMs: 1000, maxEntries: 1, now: () => now, load })
    await cache.get('key')
    await cache.get('key')
    expect(load).toHaveBeenCalledOnce()
    now = 1001
    await cache.get('key')
    expect(load).toHaveBeenLastCalledWith('key', null)
    cache.replace('key', 'verified')
    cache.invalidate('key', { keepStale: true })
    await cache.get('key')
    expect(load).toHaveBeenLastCalledWith('key', 'verified')
  })

  it('does not cache failures or retain forgotten plaintext as a fallback', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('recovered')
    const cache = createLocalSnapshot<string, string>({ ttlMs: 1000, maxEntries: 1, load })
    await expect(cache.get('key')).rejects.toThrow('offline')
    await expect(cache.get('key')).resolves.toBe('recovered')
    cache.invalidate('key')
    await cache.get('key')
    expect(load).toHaveBeenLastCalledWith('key', undefined)
  })
})
