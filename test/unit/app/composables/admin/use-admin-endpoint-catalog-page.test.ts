import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformEndpointCatalog, PlatformEndpointCatalogItem, PlatformEndpointCatalogService, PlatformEndpointPublicationResult } from '#shared/types/platform'
import { useAdminEndpointCatalogPage } from '@/composables/admin/use-admin-endpoint-catalog-page'

const { resource } = vi.hoisted(() => ({ resource: vi.fn() }))
vi.mock('@/composables/dashboard/use-private-resource', () => ({ usePrivateResource: resource }))

const fetchMock = vi.fn()
const confirm = vi.fn()
const toast = vi.fn()
const refreshCatalog = vi.fn()
let scope = effectScope()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function endpoint(key: string, status: PlatformEndpointCatalogItem['status'], publishable = true): PlatformEndpointCatalogItem {
  return {
    key,
    status,
    publishable,
    sourceKind: 'discovered',
    endpoint: { method: 'GET', path: `/v1/${key}`, operationId: key },
    route: status === 'available' ? null : {
      route: { id: key, pathPattern: `/v1/${key}`, state: status === 'live' ? 'active' : 'disabled' }
    }
  } as PlatformEndpointCatalogItem
}

function setup(items: PlatformEndpointCatalogItem[]) {
  const service = {
    upstream: { id: 'service-1', name: 'Service', status: 'active' },
    endpoints: items,
    targetDrift: []
  } as unknown as PlatformEndpointCatalogService
  const catalog = ref<PlatformEndpointCatalog>({
    activeRevisionId: 'revision-1',
    activeRevisionSequence: 1,
    services: [service],
    totals: { discovered: items.length, live: 0, available: 0, pending: 0, disabled: 0, driftedTargets: 0 }
  })
  resource.mockReturnValue({
    data: catalog,
    refresh: refreshCatalog,
    loading: ref(false),
    error: ref(null)
  })
  const page = scope.run(() => useAdminEndpointCatalogPage())!
  function rowState(key: string) {
    const item = catalog.value.services.flatMap(service => service.endpoints).find(item => item.key === key)
    if (!item) throw new Error('Missing catalog item: ' + key)
    return page.endpointState(item)
  }
  return { page, catalog, service, rowState }
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
})

afterEach(() => {
  scope.stop()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('endpoint selection and feedback', () => {
  it('holds advanced settings admission through refresh and blocks apply, batch and duplicate saves', async () => {
    const item = endpoint('one', 'live')
    const { page, catalog } = setup([item])
    catalog.value.totals.pending = 1
    page.selectAllEndpoints(true)
    const pending = deferred<PlatformEndpointPublicationResult>()
    const reading = deferred<undefined>()
    fetchMock.mockReturnValueOnce(pending.promise)
    refreshCatalog.mockReturnValueOnce(reading.promise)
    const operation = page.saveSettings('one', { name: 'Edited', creditsCost: 5, isApiKey: true, isStatistics: true })
    expect(page.settingsState('one')).toMatchObject({ loading: true, disabled: true })
    await page.saveSettings('one', { name: 'Duplicate' })
    await page.applyChanges()
    await page.bulkSetEnabled(false)
    await page.toggleStatistics(item)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]).toEqual(['/api/admin/v1/service-endpoints/one', {
      method: 'PATCH', body: { name: 'Edited', creditsCost: 5, isApiKey: true, isStatistics: true }
    }])
    pending.resolve({ route: { id: 'one' }, revision: null } as PlatformEndpointPublicationResult)
    await vi.waitFor(() => expect(refreshCatalog).toHaveBeenCalledOnce())
    expect(page.settingsState('one').loading).toBe(true)
    reading.resolve(undefined)
    await expect(operation).resolves.toBe(true)
    expect(page.settingsState('one').disabled).toBe(false)
  })

  it('rechecks settings admission when apply starts after opening the editor', async () => {
    const item = endpoint('one', 'live')
    const { page, catalog } = setup([item])
    page.openEditRoute(item)
    catalog.value.totals.pending = 1
    const pending = deferred<{ revision: { id: string } }>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const applying = page.applyChanges()
    await expect(page.saveSettings('one', { name: 'Edited' })).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
    pending.resolve({ revision: { id: 'revision-2' } })
    await applying
  })

  it('permits paid advanced settings and refuses a route removed since the editor opened', async () => {
    const item = endpoint('one', 'live')
    item.route!.route.creditsCost = 5
    const { page, catalog } = setup([item])
    await expect(page.saveSettings('one', { creditsCost: 10 })).resolves.toBe(true)
    catalog.value.services[0]!.endpoints = []
    expect(page.settingsState('one').disabled).toBe(true)
    await expect(page.saveSettings('one', { creditsCost: 0 })).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps failed settings open for retry and clears the error on the next attempt', async () => {
    const { page } = setup([endpoint('one', 'live')])
    fetchMock.mockRejectedValueOnce({ data: { message: 'rejected' } })
    await expect(page.saveSettings('one', { name: 'Edited' })).resolves.toBe(false)
    expect(page.settingsState('one').error).toBe('rejected')
    await expect(page.saveSettings('one', { name: 'Edited' })).resolves.toBe(true)
    expect(page.settingsState('one').error).toBeNull()
  })

  it('does not convert saved settings to failure when refresh returns an error', async () => {
    const { page, rowState } = setup([endpoint('one', 'live')])
    refreshCatalog.mockResolvedValueOnce({ status: 'error', error: new Error('read failed') })
    await expect(page.saveSettings('one', { name: 'Edited' })).resolves.toBe(true)
    expect(rowState('one').feedback?.color).toBe('warning')
    expect(page.catalogFeedback.value?.color).toBe('error')
    expect(refreshCatalog).toHaveBeenCalledOnce()
  })

  it('ignores settings responses after disposal', async () => {
    const { page, rowState } = setup([endpoint('one', 'live')])
    const pending = deferred<PlatformEndpointPublicationResult>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const saving = page.saveSettings('one', { name: 'Edited' })
    scope.stop()
    pending.resolve({ route: { id: 'one' }, revision: null } as PlatformEndpointPublicationResult)
    await expect(saving).resolves.toBe(false)
    expect(rowState('one').feedback).toBeUndefined()
    expect(refreshCatalog).not.toHaveBeenCalled()
    await expect(page.saveSettings('one', { name: 'Again' })).resolves.toBe(false)
  })

  it('applies pending changes while another Service awaits address discovery', async () => {
    const { page, catalog } = setup([endpoint('one', 'pending')])
    catalog.value.totals.pending = 1
    catalog.value.services.push({
      upstream: { id: 'other-service', name: 'Other Service', status: 'active' },
      endpoints: [],
      targetDrift: [{ targetId: 'changed', kind: 'address_changed', runtimeBaseUrl: 'http://old:8080/', desiredBaseUrl: 'http://new:8080/' }]
    } as unknown as PlatformEndpointCatalogService)
    expect(page.requiresDiscovery.value).toBe(true)
    expect(page.canApply.value).toBe(true)
    fetchMock.mockResolvedValueOnce({ revision: { id: 'revision-2' } })
    await page.applyChanges()
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/v1/service-endpoints/apply', { method: 'POST' })
  })

  it('does not offer publication for an unverified address change alone', async () => {
    const { page, catalog } = setup([])
    catalog.value.services[0]!.targetDrift = [{ targetId: 'changed', kind: 'address_changed', runtimeBaseUrl: 'http://old:8080/', desiredBaseUrl: 'http://new:8080/' }]
    expect(page.requiresDiscovery.value).toBe(true)
    expect(page.canApply.value).toBe(false)
    await page.applyChanges()
    expect(fetchMock).not.toHaveBeenCalled()
  })

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
    const { page, service, rowState } = setup([item])
    await expect(page.handlePrimaryAction(service, item)).resolves.toBe(true)
    expect(rowState('one').feedback).toEqual({
      message: 'admin.apis.routing.catalog.feedback.savedPending', color: 'warning'
    })
    fetchMock.mockRejectedValueOnce(new Error('network failure'))
    await expect(page.handlePrimaryAction(service, item)).resolves.toBe(false)
    expect(rowState('one').feedback?.color).toBe('error')
    expect(page.controls.value.selectionDisabled).toBe(false)
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
    expect(resource).toHaveBeenCalledOnce()
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
    expect(page.controls.value.selectionDisabled).toBe(false)
  })

  it('keeps feedback when publishing changes the catalog key', async () => {
    const item = endpoint('new', 'available')
    const { page, catalog, service, rowState } = setup([item])
    refreshCatalog.mockImplementationOnce(() => {
      catalog.value.services[0]!.endpoints = [{ ...endpoint('created', 'pending'), key: 'new-bound-key' }]
      return Promise.resolve()
    })
    await page.handlePrimaryAction(service, item)
    expect(rowState('new-bound-key').feedback).toEqual({
      message: 'admin.apis.routing.catalog.feedback.savedPending', color: 'warning'
    })
  })

  it('clears pending feedback after applying the staged endpoint changes', async () => {
    const { page, catalog, rowState } = setup([endpoint('one', 'disabled'), endpoint('two', 'disabled')])
    page.selectAllEndpoints(true)
    await page.bulkSetEnabled(true)
    expect(rowState('one').feedback?.color).toBe('warning')
    expect(page.bulkFeedback.value?.message).toContain('"pending":2')
    catalog.value.totals.pending = 2
    fetchMock.mockResolvedValueOnce({ revision: { id: 'revision-2' } })
    await page.applyChanges()
    expect(rowState('one').feedback).toBeUndefined()
    expect(rowState('two').feedback).toBeUndefined()
    expect(page.bulkFeedback.value).toBeNull()
    expect(page.catalogFeedback.value).toMatchObject({
      message: 'admin.apis.routing.catalog.feedback.changesApplied', color: 'success'
    })
    expect(toast).not.toHaveBeenCalled()
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

  it('shows saved settings on the endpoint row without a floating notification', async () => {
    const { page, rowState } = setup([endpoint('one', 'live')])
    await page.saveSettings('one', { name: 'Edited' })
    expect(rowState('one').feedback).toEqual({
      message: 'admin.apis.routing.catalog.feedback.savedPending', color: 'warning'
    })
    expect(refreshCatalog).toHaveBeenCalledOnce()
    expect(toast).not.toHaveBeenCalled()
  })

  it('keeps an apply failure and its blocking Service visible on the page', async () => {
    const { page, catalog } = setup([endpoint('one', 'pending')])
    catalog.value.totals.pending = 1
    fetchMock.mockRejectedValueOnce({ data: { data: { upstreamServiceId: 'service-1' } } })
    await page.applyChanges()
    expect(page.catalogFeedback.value).toMatchObject({
      color: 'error',
      description: 'admin.apis.routing.catalog.feedback.applyBlockedBy:{"upstream":"Service"}'
    })
    expect(toast).not.toHaveBeenCalled()
    expect(page.controls.value.selectionDisabled).toBe(false)
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
    expect(page.controls.value.selectionDisabled).toBe(false)
  })

  it('prevents overlapping batches and selection changes while requests are running', async () => {
    const { page } = setup([endpoint('one', 'disabled'), endpoint('two', 'disabled')])
    let finish!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    page.selectAllEndpoints(true)
    const operation = page.bulkSetEnabled(true)
    expect(page.controls.value.selectionDisabled).toBe(true)
    page.selectAllEndpoints(false)
    expect(page.selectedKeys.value.size).toBe(2)
    await page.bulkSetEnabled(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    finish({ revision: null })
    await operation
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(page.selectedKeys.value.size).toBe(0)
    expect(page.controls.value.selectionDisabled).toBe(false)
  })
})

describe('catalog operation admission and lifecycle', () => {
  it.each(['apply', 'bulk', 'endpoint', 'discovery'] as const)('keeps displayed controls and execution consistent during %s', async (kind) => {
    const one = endpoint('one', 'disabled')
    const two = endpoint('two', 'disabled')
    const { page, catalog, service } = setup([one, two])
    catalog.value.totals.pending = 1
    page.selectAllEndpoints(true)
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const operation = kind === 'apply' ? page.applyChanges()
      : kind === 'bulk' ? page.bulkSetEnabled(true)
        : kind === 'endpoint' ? page.handlePrimaryAction(service, one)
          : page.discoverService(service.upstream.id)

    expect(page.controls.value).toMatchObject({
      applyDisabled: true, discoveryDisabled: true, bulkEnableDisabled: true,
      bulkDisableDisabled: true, selectionDisabled: true, refreshDisabled: true,
      filtersDisabled: kind === 'bulk'
    })
    expect(page.discoveryState(service.upstream.id)).toEqual({ loading: kind === 'discovery', disabled: true })
    expect(page.endpointState(one).loading).toBe(kind === 'endpoint' || kind === 'bulk')
    expect(page.endpointState(two).primaryDisabled).toBe(kind === 'apply' || kind === 'bulk')
    await page.applyChanges()
    await page.discoverAllServices()
    await page.discoverService(service.upstream.id)
    await page.bulkSetEnabled(true)
    await page.refresh()
    page.selectAllEndpoints(false)
    expect(page.selectedKeys.value.size).toBe(2)
    expect(refreshCatalog).not.toHaveBeenCalled()

    if (kind !== 'discovery') {
      expect(page.endpointState(one).primaryDisabled).toBe(true)
      await expect(page.handlePrimaryAction(service, one)).resolves.toBe(false)
      await expect(page.toggleStatistics(one)).resolves.toBe(false)
      await expect(page.toggleApiKey(one)).resolves.toBe(false)
      page.openEditRoute(one)
      expect(page.routeModalOpen.value).toBe(false)
    }
    expect(fetchMock).toHaveBeenCalledOnce()

    request.resolve(kind === 'discovery'
      ? { connection: { lastDiscoveryError: null } }
      : { revision: { id: 'revision-2' }, route: { id: 'one' } })
    await operation
    expect(page.controls.value.selectionDisabled).toBe(false)
    expect(page.endpointState(one).loading).toBe(false)
  })

  it('preserves endpoint changes during discovery and releases a failed discovery', async () => {
    const item = endpoint('one', 'disabled')
    const { page, service } = setup([item])
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const discovering = page.discoverService(service.upstream.id)
    expect(page.endpointState(item).primaryDisabled).toBe(false)
    await expect(page.handlePrimaryAction(service, item)).resolves.toBe(true)
    expect(page.discoveryState(service.upstream.id).loading).toBe(true)
    request.reject(new Error('discovery failed'))
    await expect(discovering).resolves.toBe(false)
    expect(page.catalogFeedback.value?.color).toBe('error')
    expect(page.discoveryState(service.upstream.id)).toEqual({ loading: false, disabled: false })
  })

  it('runs discovery workers within the parent operation and reports partial and failed results', async () => {
    const { page, catalog, service } = setup([])
    catalog.value.services = Array.from({ length: 6 }, (_, index) => ({
      ...service, upstream: { ...service.upstream, id: `service-${index}` }
    }))
    const requests = Array.from({ length: 6 }, () => deferred<unknown>())
    let nextRequest = 0
    fetchMock.mockImplementation(() => requests[nextRequest++]!.promise)
    const operation = page.discoverAllServices()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(page.controls.value.discovering).toBe(true)
    requests[0]!.resolve({ connection: { lastDiscoveryError: null } })
    requests[1]!.resolve({ connection: { lastDiscoveryError: 'partial' } })
    requests[2]!.reject(new Error('unavailable'))
    requests[3]!.resolve({ connection: { lastDiscoveryError: null } })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6))
    requests[4]!.resolve({ connection: { lastDiscoveryError: null } })
    requests[5]!.resolve({ connection: { lastDiscoveryError: null } })
    await operation
    expect(refreshCatalog).toHaveBeenCalledOnce()
    expect(page.catalogFeedback.value).toEqual({
      message: 'admin.apis.routing.catalog.feedback.discoveryCompleted:{"succeeded":4,"partial":1,"failed":1}', color: 'error'
    })
    expect(page.controls.value.discovering).toBe(false)
    expect(page.controls.value.selectionDisabled).toBe(false)
  })

  it('holds the batch lock during confirmation without admitting external row actions', async () => {
    const item = endpoint('one', 'live')
    const { page, service } = setup([item])
    const answer = deferred<boolean>()
    confirm.mockReturnValueOnce(answer.promise)
    page.selectAllEndpoints(true)
    const operation = page.bulkSetEnabled(false)
    expect(page.controls.value.bulkRunning).toBe(true)
    expect(page.controls.value.filtersDisabled).toBe(true)
    await page.handlePrimaryAction(service, item)
    await page.toggleStatistics(item)
    await page.toggleApiKey(item)
    expect(fetchMock).not.toHaveBeenCalled()
    answer.resolve(false)
    await operation
    expect(page.controls.value.bulkRunning).toBe(false)
    expect(page.endpointState(item).settingsDisabled).toBe(false)
    expect([...page.selectedKeys.value]).toEqual(['one'])
  })

  it('rechecks single-row admission after confirmation when apply starts meanwhile', async () => {
    const item = endpoint('one', 'live')
    const { page, service, catalog } = setup([item])
    catalog.value.totals.pending = 1
    const answer = deferred<boolean>()
    confirm.mockReturnValueOnce(answer.promise)
    const disabling = page.handlePrimaryAction(service, item)
    expect(page.controls.value.selectionDisabled).toBe(false)
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const applying = page.applyChanges()
    answer.resolve(true)
    await expect(disabling).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
    request.resolve({ revision: { id: 'revision-2' } })
    await applying
  })

  it('releases the batch lock if confirmation rejects', async () => {
    const { page } = setup([endpoint('one', 'live')])
    page.selectAllEndpoints(true)
    confirm.mockRejectedValueOnce(new Error('dialog failed'))
    await expect(page.bulkSetEnabled(false)).rejects.toThrow('dialog failed')
    expect(page.controls.value.bulkRunning).toBe(false)
    expect(page.controls.value.selectionDisabled).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['pending', true], ['retiring', true], ['available', false]
  ] as const)('rejects non-actionable primary rows (%s, publishable=%s)', async (status, publishable) => {
    const item = endpoint('one', status, publishable)
    const { page, service } = setup([item])
    expect(page.endpointState(item).primaryDisabled).toBe(true)
    await expect(page.handlePrimaryAction(service, item)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces paid settings and missing-route restrictions through the same row state', async () => {
    const paid = endpoint('paid', 'live')
    paid.route!.route.creditsCost = 1
    const unbound = endpoint('new', 'available')
    const { page } = setup([paid, unbound])
    for (const item of [paid, unbound]) {
      expect(page.endpointState(item).settingsDisabled).toBe(true)
      await expect(page.toggleStatistics(item)).resolves.toBe(false)
      await expect(page.toggleApiKey(item)).resolves.toBe(false)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['toggleStatistics', 'isStatistics', false, 'statisticsEnabled'],
    ['toggleStatistics', 'isStatistics', true, 'statisticsDisabled'],
    ['toggleApiKey', 'isApiKey', false, 'apiKeyEnabled'],
    ['toggleApiKey', 'isApiKey', true, 'apiKeyDisabled']
  ] as const)('owns the patch and feedback for %s from %s=%s', async (action, field, initial, feedback) => {
    const item = endpoint('catalog-key', 'live')
    item.route!.route.id = 'route-id'
    item.route!.route[field] = initial
    const { page } = setup([item])
    fetchMock.mockResolvedValueOnce({ revision: { id: 'revision-2' }, route: { id: 'route-id' } })
    await expect(page[action](item)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/v1/service-endpoints/route-id', {
      method: 'PATCH', body: { [field]: !initial }
    })
    expect(page.endpointState(item).feedback).toEqual({
      message: `admin.apis.routing.catalog.feedback.${feedback}`, color: 'success'
    })
  })

  it('keeps loading and feedback attached across publication, refresh, failure and retry', async () => {
    const item = endpoint('new', 'available')
    const { page, catalog, service } = setup([item])
    const refreshed = { ...endpoint('created', 'pending'), key: 'new-bound-key' }
    const refreshing = deferred<undefined>()
    refreshCatalog.mockImplementationOnce(() => {
      catalog.value.services[0]!.endpoints = [refreshed]
      return refreshing.promise
    })
    const publication = page.handlePrimaryAction(service, item)
    await vi.waitFor(() => expect(refreshCatalog).toHaveBeenCalledOnce())
    expect(page.endpointState(refreshed)).toMatchObject({
      loading: true, feedback: { color: 'warning' }
    })
    refreshing.resolve(undefined)
    await publication
    expect(page.endpointState(refreshed).loading).toBe(false)
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const updating = page.toggleStatistics(refreshed)
    expect(page.endpointState(refreshed).feedback).toBeUndefined()
    request.reject(new Error('save failed'))
    await expect(updating).resolves.toBe(false)
    expect(page.endpointState(refreshed).feedback?.color).toBe('error')
    expect(page.endpointState(item).feedback?.color).toBe('error')
    fetchMock.mockResolvedValueOnce({ revision: { id: 'revision-2' }, route: { id: 'created' } })
    await expect(page.toggleStatistics(refreshed)).resolves.toBe(true)
    expect(page.endpointState(refreshed).feedback?.color).toBe('success')
  })

  it('preserves row and batch feedback when apply returns the same revision', async () => {
    const item = endpoint('one', 'disabled')
    const { page, catalog } = setup([item])
    page.selectAllEndpoints(true)
    await page.bulkSetEnabled(true)
    const feedback = page.endpointState(item).feedback
    const bulkFeedback = page.bulkFeedback.value
    catalog.value.totals.pending = 1
    fetchMock.mockResolvedValueOnce({ revision: { id: 'revision-1' } })
    await page.applyChanges()
    expect(page.endpointState(item).feedback).toEqual(feedback)
    expect(page.bulkFeedback.value).toEqual(bulkFeedback)
    expect(page.catalogFeedback.value).toMatchObject({
      description: 'admin.apis.routing.catalog.feedback.runtimeUnchanged', color: 'warning'
    })
  })

  it('keeps earlier pending results when a different Endpoint is directly applied', async () => {
    const { page, rowState } = setup([endpoint('one', 'disabled'), endpoint('two', 'disabled')])
    fetchMock.mockResolvedValueOnce({ revision: null })
      .mockResolvedValueOnce({ revision: { id: 'revision-2' } })
    page.selectAllEndpoints(true)
    await page.bulkSetEnabled(true)
    expect(rowState('one').feedback).toEqual({
      message: 'admin.apis.routing.catalog.feedback.savedPending', color: 'warning'
    })
    expect(page.bulkFeedback.value).toEqual({
      message: 'admin.apis.routing.catalog.bulk.completed:{"succeeded":2,"failed":0,"pending":1}', color: 'warning'
    })
  })
})
