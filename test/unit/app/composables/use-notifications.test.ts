import { effectScope, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNotifications } from '~/composables/use-notifications'

const fetchMock = vi.fn()
let scope = effectScope()
let poll: () => Promise<void>
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function notification(isRead = false) {
  return { id: 1, title: 'Notice', content: 'Content', level: 'info', linkUrl: null,
    isRead, readAt: null, senderActor: 'Admin', createdAt: '2026-10-01T00:00:00Z' }
}
beforeEach(() => {
  scope = effectScope()
  fetchMock.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('useIntervalFn', (callback: () => Promise<void>) => { poll = callback })
})
afterEach(() => { scope.stop(); vi.unstubAllGlobals() })

describe('notification read/write lifecycle', () => {
  it('rejects a pre-write list even if it arrives after marking read', async () => {
    const oldList = deferred<ReturnType<typeof notification>[]>()
    let lists = 0
    let read = false
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/list')) return ++lists === 2 ? oldList.promise : [notification(read)]
      if (url.endsWith('/mark-read')) { read = true; return { id: 1 } }
      return { count: read ? 0 : 1 }
    })
    const center = scope.run(() => useNotifications())!
    center.open.value = true
    await nextTick()
    await vi.waitFor(() => expect(center.items.value).toHaveLength(1))
    const reading = center.fetchList()
    await center.toggleNotification(center.items.value[0]!)
    oldList.resolve([notification(false)])
    await reading
    expect(center.items.value[0]?.isRead).toBe(true)
    expect(center.unread.value).toBe(0)
  })

  it('deduplicates writes and pauses polling until completion', async () => {
    const writing = deferred<{ id: number }>()
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/list')) return [notification()]
      if (url.endsWith('/mark-read')) return writing.promise
      return { count: 0 }
    })
    const center = scope.run(() => useNotifications())!
    await center.fetchList()
    const item = center.items.value[0]!
    const first = center.toggleNotification(item)
    await center.toggleNotification(item)
    await center.markAllRead()
    await poll()
    await center.fetchList()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    writing.resolve({ id: 1 })
    await first
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/mark-'))).toHaveLength(1)
    expect(center.busy.value).toBe(false)
  })

  it('uses a fresh count after mark-all rather than hiding notifications arriving during the write', async () => {
    const writing = deferred<{ updated: number }>()
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/mark-all-read')) return writing.promise
      return url.endsWith('/list') ? [notification(true)] : { count: 1 }
    })
    const center = scope.run(() => useNotifications())!
    const operation = center.markAllRead()
    writing.resolve({ updated: 1 })
    await operation
    expect(center.unread.value).toBe(1)
  })

  it('reports failed writes and leaves notifications retryable', async () => {
    const failure = new Error('offline')
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/mark-read')) throw failure
      return url.endsWith('/list') ? [notification()] : { count: 1 }
    })
    const center = scope.run(() => useNotifications())!
    await center.fetchList()
    await center.toggleNotification(center.items.value[0]!)
    expect(center.mutationError.value).toBe(failure)
    expect(center.items.value[0]?.isRead).toBe(false)
    expect(center.busy.value).toBe(false)
  })

  it('does not update or refresh a disposed notification center', async () => {
    const writing = deferred<{ updated: number }>()
    fetchMock.mockReturnValue(writing.promise)
    const center = scope.run(() => useNotifications())!
    const operation = center.markAllRead()
    scope.stop()
    writing.resolve({ updated: 1 })
    await operation
    await center.markAllRead()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
