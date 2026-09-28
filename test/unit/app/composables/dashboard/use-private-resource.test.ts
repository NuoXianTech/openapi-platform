import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { usePrivateResource } from '@/composables/dashboard/use-private-resource'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePrivateResource', () => {
  it('returns a read failure while retaining the last successful detail', async () => {
    const failure = { message: 'network down' }
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce({ id: 1 }).mockRejectedValueOnce(failure))
    const resource = usePrivateResource({ path: '/api/detail', defaultData: () => ({ id: 0 }), immediate: false })
    await expect(resource.refresh()).resolves.toEqual({ status: 'success', data: { id: 1 } })
    await expect(resource.refresh()).resolves.toEqual({ status: 'error', error: failure })
    expect(resource.data.value).toEqual({ id: 1 })
    expect(resource.error.value).toBe(failure)
  })

  it('rejects late results and retained refresh calls after scope disposal', async () => {
    let resolve!: (value: { id: number }) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise(res => { resolve = res }))
    vi.stubGlobal('$fetch', fetchMock)
    const scope = effectScope()
    const resource = scope.run(() => usePrivateResource({ path: '/api/detail', defaultData: () => ({ id: 0 }), immediate: false }))!
    const pending = resource.refresh()
    scope.stop()
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true)
    resolve({ id: 1 })
    await expect(pending).resolves.toEqual({ status: 'disposed' })
    await expect(resource.refresh()).resolves.toEqual({ status: 'disposed' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(resource.data.value).toEqual({ id: 0 })
    expect(resource.loading.value).toBe(false)
  })

  it('returns superseded for a late error without replacing the current success', async () => {
    let reject!: (error: unknown) => void
    vi.stubGlobal('$fetch', vi.fn().mockReturnValueOnce(new Promise((_resolve, rej) => { reject = rej })).mockResolvedValueOnce({ id: 2 }))
    const resource = usePrivateResource({ path: '/api/detail', defaultData: () => ({ id: 0 }), immediate: false })
    const stale = resource.refresh()
    await expect(resource.refresh()).resolves.toEqual({ status: 'success', data: { id: 2 } })
    reject(new Error('stale failure'))
    await expect(stale).resolves.toEqual({ status: 'superseded' })
    expect(resource.error.value).toBeNull()
    expect(resource.status.value).toBe('success')
  })

  it('resolves reactive request inputs for every refresh', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
    vi.stubGlobal('$fetch', fetchMock)

    const path = ref('/api/first')
    const query = ref<Record<string, unknown>>({ scope: 'first' })
    const resource = usePrivateResource({
      path: () => path.value,
      query,
      defaultData: () => ({ id: 0 }),
      immediate: false
    })

    await resource.refresh()
    path.value = '/api/second'
    query.value = { scope: 'second' }
    await resource.refresh()

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/first', {
      query: { scope: 'first' },
      signal: expect.objectContaining({ aborted: false }),
      timeout: 15_000
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/second', {
      query: { scope: 'second' },
      signal: expect.objectContaining({ aborted: false }),
      timeout: 15_000
    })
    expect(resource.data.value).toEqual({ id: 2 })
    expect(resource.status.value).toBe('success')
  })

  it('aborts an obsolete request and keeps the latest result', async () => {
    let firstSignal: AbortSignal | undefined
    const fetchMock = vi.fn()
      .mockImplementationOnce((
        _path: string,
        options: { signal: AbortSignal }
      ) => {
        firstSignal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
      })
      .mockResolvedValueOnce({ id: 2 })
    vi.stubGlobal('$fetch', fetchMock)

    const resource = usePrivateResource({
      path: '/api/example',
      defaultData: () => ({ id: 0 }),
      immediate: false
    })

    const obsoleteRefresh = resource.refresh()
    const latestRefresh = resource.refresh()
    await Promise.all([obsoleteRefresh, latestRefresh])

    expect(firstSignal?.aborted).toBe(true)
    expect(resource.data.value).toEqual({ id: 2 })
    expect(resource.status.value).toBe('success')
    expect(resource.error.value).toBeNull()
  })

  it('leaves the loading state when a request fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
    vi.stubGlobal('$fetch', fetchMock)

    const resource = usePrivateResource({
      path: '/api/example',
      defaultData: () => null,
      immediate: false,
      timeoutMs: 5_000
    })

    await resource.refresh()

    expect(fetchMock).toHaveBeenCalledWith('/api/example', {
      query: undefined,
      signal: expect.objectContaining({ aborted: false }),
      timeout: 5_000
    })
    expect(resource.loading.value).toBe(false)
    expect(resource.status.value).toBe('error')
    expect(resource.error.value).toBeInstanceOf(Error)
  })

  it('leaves the loading state when a request times out', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((
      _path: string,
      options: { signal: AbortSignal, timeout: number }
    ) => new Promise((_resolve, reject) => {
      setTimeout(() => {
        reject(new DOMException('Request timed out', 'TimeoutError'))
      }, options.timeout)
    }))
    vi.stubGlobal('$fetch', fetchMock)

    const resource = usePrivateResource({
      path: '/api/pending',
      defaultData: () => null,
      immediate: false,
      timeoutMs: 100
    })

    const refresh = resource.refresh()
    await vi.advanceTimersByTimeAsync(100)
    await refresh

    expect(resource.loading.value).toBe(false)
    expect(resource.status.value).toBe('error')
    expect(resource.error.value).toMatchObject({ name: 'TimeoutError' })
    vi.useRealTimers()
  })
})
