import { effectScope, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAdminOperationLogList } from '@/composables/admin/use-admin-operation-logs-page'
import { useAdminLoginLogList } from '@/composables/admin/use-admin-login-logs-page'
import { useAdminCallLogsPage } from '@/composables/admin/use-admin-call-logs-page'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup() {
  const toast = vi.fn()
  const http = vi.fn().mockImplementation((_url, options) => Promise.resolve(
    options?.method === 'POST' ? { affected: 4 } : { items: [], total: 4 }
  ))
  vi.stubGlobal('useI18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key,
    te: () => false
  }))
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('$fetch', http)
  vi.stubGlobal('parseFetchError', (_error: unknown, fallback: string) => fallback)
  const scope = effectScope()
  scopes.push(scope)
  return { http, toast, scope }
}

const pages = [
  { name: 'operation', create: () => useAdminOperationLogList({ immediate: false }), path: '/api/admin/operation-logs' },
  { name: 'login', create: () => useAdminLoginLogList({ immediate: false }), path: '/api/admin/login-logs' },
  { name: 'call', create: () => useAdminCallLogsPage({ immediate: false }), path: '/api/admin/logs' }
]

describe('log cleanup through the page interface', () => {
  it.each(pages)('keeps the preview predicate when the $name filter draft changes during the read', async ({ create, path }) => {
    const { scope, http } = setup()
    const page = scope.run(create)!
    const read = deferred<{ items: never[], total: number }>()
    http.mockReturnValueOnce(read.promise)
    page.filters.userId = 11
    const opening = page.openCleanup()
    expect(http).toHaveBeenCalledWith(`${path}/list`, expect.objectContaining({ query: expect.objectContaining({ userId: 11 }) }))
    page.filters.userId = 22
    await nextTick()
    expect(http).toHaveBeenCalledOnce()
    read.resolve({ items: [], total: 4 })
    await opening
    expect(page.cleanupMatchCount.value).toBe(4)
    expect(page.cleanupHasFilters.value).toBe(true)
    await expect(page.confirmCleanup.value()).resolves.toBe(true)
    expect(http).toHaveBeenCalledWith(`${path}/cleanup`, {
      method: 'POST', body: { userId: 11, confirm: true, deleteAll: false }
    })
  })

  it('uses the preview response count even when a later refresh completes during URL synchronization', async () => {
    const { scope, http } = setup()
    const entered = deferred<undefined>()
    const synchronize = deferred<undefined>()
    const page = scope.run(() => useAdminCallLogsPage({
      immediate: false,
      replaceQuery: () => { entered.resolve(undefined); return synchronize.promise }
    }))!
    page.filters.userId = 11
    const opening = page.openCleanup()
    await entered.promise
    page.filters.userId = 22
    http.mockResolvedValueOnce({ items: [], total: 99 })
    await page.refresh()
    expect(page.total.value).toBe(99)
    synchronize.resolve(undefined)
    await opening
    expect(page.cleanupMatchCount.value).toBe(4)
    await page.confirmCleanup.value()
    expect(http).toHaveBeenCalledWith('/api/admin/logs/cleanup', {
      method: 'POST', body: { userId: 11, confirm: true, deleteAll: false }
    })
  })

  it('preserves false-valued login filters across GET and POST encoding', async () => {
    const { scope, http } = setup()
    const page = scope.run(() => useAdminLoginLogList({ immediate: false }))!
    page.filters.success = 'failure'
    await page.openCleanup()
    expect(http.mock.calls[0]![1].query.success).toBe('failure')
    page.filters.success = 'success'
    await page.confirmCleanup.value()
    expect(http.mock.calls[1]![1].body).toEqual({ success: false, confirm: true, deleteAll: false })
  })

  it('copies array-valued call filters before later draft edits', async () => {
    const { scope, http } = setup()
    const page = scope.run(() => useAdminCallLogsPage({ immediate: false }))!
    page.filters.types.push('error')
    await page.openCleanup()
    expect(http.mock.calls[0]![1].query.types).toBe('error')
    page.filters.types.push('consume')
    await page.confirmCleanup.value()
    expect(http.mock.calls[1]![1].body).toEqual({ types: ['error'], confirm: true, deleteAll: false })
  })

  it('marks an unfiltered deletion explicitly and cannot confirm before a preview', async () => {
    const { scope, http } = setup()
    const page = scope.run(pages[0]!.create)!
    await expect(page.confirmCleanup.value()).resolves.toBe(false)
    expect(http).not.toHaveBeenCalled()
    await page.openCleanup()
    expect(page.cleanupHasFilters.value).toBe(false)
    await page.confirmCleanup.value()
    expect(http.mock.calls[1]![1].body).toEqual({ confirm: true, deleteAll: true })
  })

  it('does not open a confirmation for an empty result', async () => {
    const { scope, http, toast } = setup()
    const page = scope.run(pages[0]!.create)!
    http.mockResolvedValueOnce({ items: [], total: 0 })
    await page.openCleanup()
    expect(page.cleanupOpen.value).toBe(false)
    await expect(page.confirmCleanup.value()).resolves.toBe(false)
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'admin.logs.cleanup.noMatching', color: 'neutral' })
    expect(http).toHaveBeenCalledOnce()
  })

  it('reports a preview read failure without treating it as zero matches', async () => {
    const { scope, http, toast } = setup()
    const page = scope.run(pages[0]!.create)!
    http.mockRejectedValueOnce(new Error('read failed'))
    await page.openCleanup()
    expect(page.cleanupOpen.value).toBe(false)
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'common.feedback.loadFailed', color: 'error' })
    await expect(page.confirmCleanup.value()).resolves.toBe(false)
  })

  it('handles thrown filter preparation errors without retaining an old confirmation', async () => {
    const { scope, toast, http } = setup()
    const page = scope.run(pages[0]!.create)!
    await page.openCleanup()
    page.filters.startAt = 'invalid date'
    await page.openCleanup()
    expect(page.cleanupOpen.value).toBe(false)
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'common.feedback.loadFailed', color: 'error' })
    await expect(page.confirmCleanup.value()).resolves.toBe(false)
    expect(http).toHaveBeenCalledOnce()
  })

  it.each(['refresh', 'dispose'] as const)('ignores an obsolete preview after %s', async (action) => {
    const { scope, http, toast } = setup()
    const page = scope.run(pages[0]!.create)!
    const read = deferred<{ items: never[], total: number }>()
    http.mockReturnValueOnce(read.promise)
    const opening = page.openCleanup()
    if (action === 'refresh') await page.refresh()
    else scope.stop()
    read.resolve({ items: [], total: 4 })
    await opening
    expect(page.cleanupOpen.value).toBe(false)
    expect(toast).not.toHaveBeenCalled()
    await expect(page.confirmCleanup.value()).resolves.toBe(false)
    if (action === 'dispose') {
      await page.openCleanup()
      expect(http).toHaveBeenCalledOnce()
    }
  })

  it('keeps only the latest preview when requests finish out of order', async () => {
    const { scope, http, toast } = setup()
    const page = scope.run(pages[0]!.create)!
    const read = deferred<{ items: never[], total: number }>()
    page.filters.userId = 11
    http.mockReturnValueOnce(read.promise)
    const first = page.openCleanup()
    page.filters.userId = 22
    await page.openCleanup()
    read.reject(new Error('old read failed'))
    await first
    expect(toast).not.toHaveBeenCalled()
    await page.confirmCleanup.value()
    expect(http).toHaveBeenCalledWith('/api/admin/operation-logs/cleanup', {
      method: 'POST', body: { userId: 22, confirm: true, deleteAll: false }
    })
  })

  it.each(['cancel', 'dispose', 'consumed'] as const)('rejects a retained confirmation after %s', async (action) => {
    const { scope, http } = setup()
    const page = scope.run(pages[0]!.create)!
    await page.openCleanup()
    const confirm = page.confirmCleanup.value
    if (action === 'consumed') await page.confirmCleanup.value()
    if (action === 'cancel') page.cleanupOpen.value = false
    if (action === 'dispose') scope.stop()
    const calls = http.mock.calls.length
    await expect(confirm()).resolves.toBe(false)
    expect(http).toHaveBeenCalledTimes(calls)
  })

  it('does not let an old callback confirm a newly opened preview', async () => {
    const { scope, http } = setup()
    const page = scope.run(pages[0]!.create)!
    page.filters.userId = 11
    await page.openCleanup()
    const oldConfirm = page.confirmCleanup.value
    page.cleanupOpen.value = false
    page.filters.userId = 22
    await page.openCleanup()
    await expect(oldConfirm()).resolves.toBe(false)
    expect(http).toHaveBeenCalledTimes(2)
    await expect(page.confirmCleanup.value()).resolves.toBe(true)
    expect(http.mock.calls[2]![1].body).toEqual({ userId: 22, confirm: true, deleteAll: false })
  })

  it('allows a failed mutation to retry only its original confirmation', async () => {
    const { scope, http, toast } = setup()
    const page = scope.run(pages[0]!.create)!
    page.filters.userId = 11
    await page.openCleanup()
    http.mockRejectedValueOnce(new Error('delete failed'))
    await expect(page.confirmCleanup.value()).resolves.toBe(false)
    expect(page.cleanupOpen.value).toBe(true)
    expect(toast).toHaveBeenCalledWith({ title: 'admin.logs.cleanup.failed', color: 'error' })
    page.filters.userId = 22
    await expect(page.confirmCleanup.value()).resolves.toBe(true)
    expect(http.mock.calls.filter(call => call[1]?.method === 'POST').map(call => call[1].body.userId)).toEqual([11, 11])
  })

  it.each(['success', 'failure'] as const)('stops duplicate dispatch and suppresses obsolete mutation %s after disposal', async (outcome) => {
    const { scope, http, toast } = setup()
    const page = scope.run(pages[0]!.create)!
    await page.openCleanup()
    const mutation = deferred<{ affected: number }>()
    http.mockReturnValueOnce(mutation.promise)
    const confirming = page.confirmCleanup.value()
    await expect(page.confirmCleanup.value()).resolves.toBe(false)
    await page.openCleanup()
    expect(http).toHaveBeenCalledTimes(2)
    scope.stop()
    if (outcome === 'success') mutation.resolve({ affected: 4 })
    else mutation.reject(new Error('late failure'))
    await expect(confirming).resolves.toBe(false)
    expect(http).toHaveBeenCalledTimes(2)
    expect(toast).not.toHaveBeenCalled()
    expect(page.cleanupLoading.value).toBe(false)
  })

  it('consumes a successful deletion even when the follow-up refresh fails', async () => {
    const { scope, http, toast } = setup()
    const page = scope.run(pages[0]!.create)!
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await page.openCleanup()
    http.mockResolvedValueOnce({ affected: 4 }).mockRejectedValueOnce(new Error('refresh failed'))
    await expect(page.confirmCleanup.value()).resolves.toBe(true)
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'admin.logs.cleanup.success:{"count":4}', color: 'success' })
    expect(log).toHaveBeenCalledOnce()
    await expect(page.confirmCleanup.value()).resolves.toBe(false)
    expect(http).toHaveBeenCalledTimes(3)
  })
})
