import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformEndpointCatalog, PlatformEndpointCatalogItem, PlatformEndpointCatalogService } from '#shared/types/platform'
import { useAdminEndpointCatalogPage } from '@/composables/admin/use-admin-endpoint-catalog-page'

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }))
vi.mock('@/composables/dashboard/use-private-resource', () => ({ usePrivateResource: resource }))

const fetchMock = vi.fn()
const confirm = vi.fn()
const toast = vi.fn()
const refreshCatalog = vi.fn()
const refreshProducts = vi.fn()
let scope = effectScope()

function endpoint(key: string, status: PlatformEndpointCatalogItem['status'], publishable = true): PlatformEndpointCatalogItem {
  return {
    key,
    status,
    publishable,
    sourceKind: 'discovered',
    endpoint: { method: 'GET', path: `/v1/${key}`, operationId: key },
    route: status === 'available' ? null : {
      route: { id: key, pathPattern: `/v1/${key}`, enabled: status === 'live', managedBy: 'service' }
    }
  } as PlatformEndpointCatalogItem
}

function setup(items: PlatformEndpointCatalogItem[]) {
  const service = {
    upstream: { id: 'service-1', name: 'Service', status: 'active', serviceManaged: true },
    endpoints: items,
    targetDrift: []
  } as unknown as PlatformEndpointCatalogService
  const catalog = ref<PlatformEndpointCatalog>({
    activeRevisionId: 'revision-1',
    activeRevisionSequence: 1,
    services: [service],
    totals: { discovered: items.length, live: 0, available: 0, pending: 0, disabled: 0, driftedTargets: 0 }
  })
  resource.mockImplementation(({ path }: { path: string }) => ({
    data: path.endsWith('service-endpoints') ? catalog : ref([]),
    refresh: path.endsWith('service-endpoints') ? refreshCatalog : refreshProducts,
    loading: ref(false),
    error: ref(null)
  }))
  const page = scope.run(() => useAdminEndpointCatalogPage())!
  return { page, catalog, service }
}

beforeEach(() => {
  scope = effectScope()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useRoute', () => reactive({ query: {} }))
  vi.stubGlobal('useRouter', () => ({ replace: vi.fn() }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }))
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useConfirmDialog', () => confirm)
  vi.stubGlobal('$fetch', fetchMock)
  fetchMock.mockResolvedValue({ revision: null, route: { id: 'created' } })
  confirm.mockResolvedValue(true)
  refreshCatalog.mockResolvedValue(undefined)
  refreshProducts.mockResolvedValue(undefined)
})

afterEach(() => {
  scope.stop()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('endpoint selection and feedback', () => {
  it('selects only actionable visible endpoints and drops selections hidden by a filter', async () => {
    const { page } = setup([
      endpoint('live', 'live'), endpoint('available', 'available'),
      endpoint('pending', 'pending'), endpoint('retiring', 'retiring'),
      endpoint('unsupported', 'available', false)
    ])
    page.selectAllEndpoints(true)
    expect([...page.selectedKeys.value]).toEqual(['live', 'available'])
    expect(page.selectionState.value).toBe(true)
    expect(page.selectedEnableCount.value).toBe(1)
    expect(page.selectedDisableCount.value).toBe(1)
    page.statusFilter.value = 'live'
    await nextTick()
    expect([...page.selectedKeys.value]).toEqual(['live'])
    page.search.value = 'no match'
    await nextTick()
    expect(page.selectedKeys.value.size).toBe(0)
    expect(page.selectionState.value).toBe(false)
  })

  it('uses inline pending and error feedback without overlay notifications', async () => {
    const item = endpoint('one', 'disabled')
    const { page } = setup([item])
    await expect(page.updatePublication(item, { enabled: true }, 'published')).resolves.toBe(true)
    expect(page.endpointFeedback.value.one).toEqual({
      message: 'admin.apis.routing.catalog.feedback.savedPending', color: 'warning'
    })
    fetchMock.mockRejectedValueOnce(new Error('network failure'))
    await expect(page.updatePublication(item, { enabled: true }, 'published')).resolves.toBe(false)
    expect(page.endpointFeedback.value.one?.color).toBe('error')
    expect(page.operationBusy.value).toBe(false)
    expect(toast).not.toHaveBeenCalled()
  })

  it('enables only inactive selections and refreshes once after the batch', async () => {
    const { page } = setup([endpoint('live', 'live'), endpoint('new', 'available'), endpoint('disabled', 'disabled')])
    page.selectAllEndpoints(true)
    await page.bulkSetEnabled(true)
    expect(fetchMock.mock.calls).toEqual([
      ['/api/admin/v1/service-endpoints/publish', { method: 'POST', body: { upstreamServiceId: 'service-1', method: 'GET', path: '/v1/new' } }],
      ['/api/admin/v1/service-endpoints/disabled', { method: 'PATCH', body: { enabled: true } }]
    ])
    expect(refreshCatalog).toHaveBeenCalledOnce()
    expect(refreshProducts).toHaveBeenCalledOnce()
    expect([...page.selectedKeys.value]).toEqual(['live'])
    expect(page.bulkFeedback.value?.message).toContain('"succeeded":2,"failed":0,"pending":2')
    expect(confirm).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('keeps failed selections for retry and continues with the remaining items', async () => {
    const { page } = setup([endpoint('one', 'disabled'), endpoint('two', 'disabled'), endpoint('three', 'disabled')])
    fetchMock.mockResolvedValueOnce({ revision: { id: 'revision-2' } })
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ revision: null })
    page.selectAllEndpoints(true)
    await page.bulkSetEnabled(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect([...page.selectedKeys.value]).toEqual(['two'])
    expect(page.bulkFeedback.value).toEqual({
      message: 'admin.apis.routing.catalog.bulk.completed:{"succeeded":2,"failed":1,"pending":1}',
      color: 'error'
    })
    expect(page.bulkProgress.value).toEqual({ completed: 3, total: 3 })
    expect(page.operationBusy.value).toBe(false)
  })

  it('keeps feedback when publishing changes the catalog key', async () => {
    const item = endpoint('new', 'available')
    const { page, catalog, service } = setup([item])
    refreshCatalog.mockImplementationOnce(() => {
      catalog.value.services[0]!.endpoints = [{ ...endpoint('created', 'pending'), key: 'new-bound-key' }]
      return Promise.resolve()
    })
    await page.handlePrimaryAction(service, item)
    expect(page.endpointFeedback.value.created).toEqual({
      message: 'admin.apis.routing.catalog.feedback.savedPending', color: 'warning'
    })
  })

  it('updates pending feedback when a later manual mutation publishes the runtime', async () => {
    const { page } = setup([endpoint('one', 'disabled'), endpoint('two', 'disabled')])
    fetchMock.mockResolvedValueOnce({ revision: null })
      .mockResolvedValueOnce({ revision: { id: 'revision-2' } })
    page.selectAllEndpoints(true)
    await page.bulkSetEnabled(true)
    expect(page.endpointFeedback.value.one?.color).toBe('success')
    expect(page.bulkFeedback.value?.message).toContain('"pending":0')
  })

  it('confirms a batch disable once and leaves inactive selections unchanged', async () => {
    const { page } = setup([endpoint('one', 'live'), endpoint('two', 'live'), endpoint('disabled', 'disabled')])
    page.selectAllEndpoints(true)
    await page.bulkSetEnabled(false)
    expect(confirm).toHaveBeenCalledOnce()
    expect(confirm.mock.calls[0]?.[0].title).toContain('"count":2')
    expect(fetchMock.mock.calls.map(call => call[1].body)).toEqual([{ enabled: false }, { enabled: false }])
    expect([...page.selectedKeys.value]).toEqual(['disabled'])
  })

  it('preserves the selection and sends no mutation when disabling is cancelled', async () => {
    const item = endpoint('one', 'live')
    const { page, service } = setup([item])
    confirm.mockResolvedValue(false)
    page.selectAllEndpoints(true)
    await page.bulkSetEnabled(false)
    await page.handlePrimaryAction(service, item)
    expect(fetchMock).not.toHaveBeenCalled()
    expect([...page.selectedKeys.value]).toEqual(['one'])
    expect(page.operationBusy.value).toBe(false)
  })

  it('prevents overlapping batches and selection changes while requests are running', async () => {
    const { page } = setup([endpoint('one', 'disabled'), endpoint('two', 'disabled')])
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    page.selectAllEndpoints(true)
    const operation = page.bulkSetEnabled(true)
    expect(page.operationBusy.value).toBe(true)
    page.selectAllEndpoints(false)
    expect(page.selectedKeys.value.size).toBe(2)
    await page.bulkSetEnabled(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    finish({ revision: null })
    await operation
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(page.selectedKeys.value.size).toBe(0)
    expect(page.operationBusy.value).toBe(false)
  })
})
