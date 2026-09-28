import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePrivatePagedList } from '@/composables/dashboard/use-private-paged-list'

interface TestFilters extends Record<string, unknown> {
  keyword: string
}

interface TestRow {
  id: number
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePrivatePagedList', () => {
  it('clears stale rows on a resolved read failure', async () => {
    const failure = { message: 'network down' }
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce({ items: [{ id: 1 }], total: 1 }).mockRejectedValueOnce(failure))
    const list = usePrivatePagedList({ path: '/api/list', defaultFilters: {}, immediate: false })
    await list.refresh()
    await expect(list.refresh()).resolves.toEqual({ status: 'error', error: failure })
    expect(list.items.value).toEqual([])
    expect(list.total.value).toBe(0)
  })

  it('does not start requests or change filters after scope disposal', async () => {
    const request = deferred<{ items: TestRow[], total: number }>()
    const fetchMock = vi.fn().mockReturnValue(request.promise)
    vi.stubGlobal('$fetch', fetchMock)
    const scope = effectScope()
    const list = scope.run(() => usePrivatePagedList({ path: '/api/list', defaultFilters: { keyword: '' }, immediate: false, page: ref(3) }))!
    list.filters.keyword = 'keep'
    const pending = list.refresh()
    scope.stop()
    request.resolve({ items: [{ id: 1 }], total: 1 })
    await expect(pending).resolves.toEqual({ status: 'disposed' })
    for (const action of [list.refresh, list.applyFilters, list.reset]) await expect(action()).resolves.toEqual({ status: 'disposed' })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(list.filters.keyword).toBe('keep')
    expect(list.page.value).toBe(3)
    expect(list.items.value).toEqual([])
    expect(list.loading.value).toBe(false)
  })

  it('propagates a corrected-page failure and rejects malformed responses', async () => {
    const failure = new Error('corrected page failed')
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValueOnce({ items: [], total: 1 }).mockRejectedValueOnce(failure).mockResolvedValueOnce({ items: [], total: '1' }))
    const list = usePrivatePagedList({ path: '/api/list', defaultFilters: {}, immediate: false, page: ref(3) })
    await expect(list.refresh()).resolves.toEqual({ status: 'error', error: failure })
    expect(list.page.value).toBe(1)
    await expect(list.refresh()).resolves.toMatchObject({ status: 'error', error: expect.any(TypeError) })
    expect(list.items.value).toEqual([])
  })

  it('refreshes with a page reset when page size changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ items: [{ id: 1 }], total: 1 })
    vi.stubGlobal('$fetch', fetchMock)

    const page = ref(3)
    const pageSize = ref(50)
    const list = usePrivatePagedList<TestFilters, TestRow>({
      path: '/api/example',
      defaultFilters: { keyword: '' },
      immediate: false,
      page,
      pageSize
    })

    pageSize.value = 20
    await nextTick()
    await nextTick()

    expect(page.value).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/example', {
      query: { keyword: '', limit: 20, offset: 0 },
      signal: expect.any(AbortSignal),
      timeout: 15_000
    })
    expect(list.items.value).toEqual([{ id: 1 }])
  })

  it('keeps only the latest response and exposes the latest error', async () => {
    const first = deferred<{ items: TestRow[], total: number }>()
    const second = deferred<{ items: TestRow[], total: number }>()
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    vi.stubGlobal('$fetch', fetchMock)

    const list = usePrivatePagedList<TestFilters, TestRow>({
      path: '/api/example',
      defaultFilters: { keyword: '' },
      immediate: false
    })

    const firstRefresh = list.refresh()
    const secondRefresh = list.refresh()

    second.resolve({ items: [{ id: 2 }], total: 1 })
    await secondRefresh
    first.resolve({ items: [{ id: 1 }], total: 1 })
    await firstRefresh

    expect(list.items.value).toEqual([{ id: 2 }])
    expect(list.total.value).toBe(1)
    expect(list.error.value).toBeNull()

    fetchMock.mockRejectedValueOnce(new Error('network down'))
    await list.refresh()

    expect(list.status.value).toBe('error')
    expect(list.error.value).toBeInstanceOf(Error)
  })

  it('aborts an obsolete request', async () => {
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
      .mockResolvedValueOnce({ items: [{ id: 2 }], total: 1 })
    vi.stubGlobal('$fetch', fetchMock)

    const list = usePrivatePagedList<TestFilters, TestRow>({
      path: '/api/example',
      defaultFilters: { keyword: '' },
      immediate: false
    })

    const obsoleteRefresh = list.refresh()
    const latestRefresh = list.refresh()
    await Promise.all([obsoleteRefresh, latestRefresh])

    expect(firstSignal?.aborted).toBe(true)
    expect(list.items.value).toEqual([{ id: 2 }])
    expect(list.status.value).toBe('success')
    expect(list.error.value).toBeNull()
  })

  it('moves back to the last available page when refreshed data shrinks', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ items: [], total: 20 })
      .mockResolvedValueOnce({ items: [{ id: 20 }], total: 20 })
    vi.stubGlobal('$fetch', fetchMock)

    const page = ref(3)
    const pageSize = ref(10)
    const list = usePrivatePagedList<TestFilters, TestRow>({
      path: '/api/example',
      defaultFilters: { keyword: '' },
      immediate: false,
      page,
      pageSize
    })

    await list.refresh()
    await nextTick()

    expect(page.value).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/example', {
      query: { keyword: '', limit: 10, offset: 20 },
      signal: expect.any(AbortSignal),
      timeout: 15_000
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/example', {
      query: { keyword: '', limit: 10, offset: 10 },
      signal: expect.any(AbortSignal),
      timeout: 15_000
    })
    expect(list.items.value).toEqual([{ id: 20 }])
    expect(list.total.value).toBe(20)
  })
})
