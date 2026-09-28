import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAdminLogCleanup } from '@/composables/admin/use-admin-log-cleanup'

const addToast = vi.fn()
const fetchCleanup = vi.fn()

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function setupGlobals() {
  vi.stubGlobal('useI18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => params
      ? `${key}:${JSON.stringify(params)}`
      : key
  }))
  vi.stubGlobal('useToast', () => ({ add: addToast }))
  vi.stubGlobal('$fetch', fetchCleanup)
  vi.stubGlobal('parseFetchError', (_error: unknown, fallback: string) => fallback)
}

describe('useAdminLogCleanup', () => {
  it.each(['error', 'superseded', 'disposed'] as const)('does not interpret a %s read as zero matching logs', async (status) => {
    setupGlobals()
    const cleanup = useAdminLogCleanup({
      endpoint: '/api/admin/logs/cleanup', total: ref(0),
      applyFilters: vi.fn().mockResolvedValue({ status, error: new Error('read failed') }),
      refresh: vi.fn(), buildFilters: () => ({})
    })
    await cleanup.openCleanup()
    expect(cleanup.cleanupOpen.value).toBe(false)
    expect(fetchCleanup).not.toHaveBeenCalled()
    expect(addToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'admin.logs.cleanup.noMatching' }))
    if (status === 'error') expect(addToast).toHaveBeenCalledWith({ title: 'common.feedback.loadFailed', color: 'error' })
    else expect(addToast).not.toHaveBeenCalled()
  })

  it('keeps false filters and marks a conditional cleanup explicitly', async () => {
    setupGlobals()
    fetchCleanup.mockResolvedValue({ affected: 4 })
    const total = ref(4)
    const refresh = vi.fn().mockResolvedValue({ status: 'success', data: { items: [], total: 4 } })
    const cleanup = useAdminLogCleanup({
      endpoint: '/api/admin/login-logs/cleanup',
      total,
      applyFilters: vi.fn().mockResolvedValue({ status: 'success', data: { items: [], total: 4 } }),
      refresh,
      buildFilters: () => ({ keyword: '', success: false, types: [] })
    })

    await cleanup.openCleanup()
    expect(cleanup.cleanupHasFilters.value).toBe(true)
    await expect(cleanup.confirmCleanup()).resolves.toBe(true)
    expect(fetchCleanup).toHaveBeenCalledWith('/api/admin/login-logs/cleanup', {
      method: 'POST',
      body: { success: false, confirm: true, deleteAll: false }
    })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('requires the server-side delete-all flag when no filters are active', async () => {
    setupGlobals()
    fetchCleanup.mockResolvedValue({ affected: 7 })
    const cleanup = useAdminLogCleanup({
      endpoint: '/api/admin/logs/cleanup',
      total: ref(7),
      applyFilters: vi.fn().mockResolvedValue({ status: 'success', data: { items: [], total: 7 } }),
      refresh: vi.fn().mockResolvedValue({ status: 'success', data: { items: [], total: 7 } }),
      buildFilters: () => ({ keyword: undefined, types: [] })
    })

    await cleanup.openCleanup()
    expect(cleanup.cleanupHasFilters.value).toBe(false)
    await cleanup.confirmCleanup()
    expect(fetchCleanup).toHaveBeenCalledWith('/api/admin/logs/cleanup', {
      method: 'POST',
      body: { confirm: true, deleteAll: true }
    })
  })

  it('does not open the dialog when the applied filters match no logs', async () => {
    setupGlobals()
    const total = ref(3)
    const cleanup = useAdminLogCleanup({
      endpoint: '/api/admin/operation-logs/cleanup',
      total,
      applyFilters: vi.fn(async () => { total.value = 0; return { status: 'success', data: { items: [], total: 0 } } as const }),
      refresh: vi.fn().mockResolvedValue({ status: 'success', data: { items: [], total: 0 } }),
      buildFilters: () => ({ action: 'admin.' })
    })

    await cleanup.openCleanup()
    expect(cleanup.cleanupOpen.value).toBe(false)
    expect(fetchCleanup).not.toHaveBeenCalled()
    expect(addToast).toHaveBeenCalledWith({
      title: 'admin.logs.cleanup.noMatching',
      color: 'neutral'
    })
  })

  it('does not report a completed deletion as failed when the refresh returns an error', async () => {
    setupGlobals()
    fetchCleanup.mockResolvedValue({ affected: 2 })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const cleanup = useAdminLogCleanup({
      endpoint: '/api/admin/logs/cleanup',
      total: ref(2),
      applyFilters: vi.fn().mockResolvedValue({ status: 'success', data: { items: [], total: 2 } }),
      refresh: vi.fn().mockResolvedValue({ status: 'error', error: new Error('refresh failed') }),
      buildFilters: () => ({ keyword: 'api' })
    })

    await cleanup.openCleanup()
    await expect(cleanup.confirmCleanup()).resolves.toBe(true)
    expect(cleanup.cleanupLoading.value).toBe(false)
    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith({
      title: 'admin.logs.cleanup.success:{"count":2}',
      color: 'success'
    })
    expect(consoleError).toHaveBeenCalledOnce()
  })
})
