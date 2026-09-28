import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformUpstream, PlatformUpstreamTarget } from '#shared/types/platform'
import type { ServiceConfigurationSyncOutcome, ServiceConfigurationView } from '#shared/types/service-control'
import { useAdminServiceControl } from '~/composables/admin/use-admin-service-control'
import { useAdminServiceConfigurationForm } from '~/composables/admin/use-admin-service-configuration-form'

const { resourceFactory } = vi.hoisted(() => ({ resourceFactory: vi.fn() }))
vi.mock('~/composables/dashboard/use-private-resource', () => ({ usePrivateResource: resourceFactory }))
const fetchMock = vi.fn()
const confirm = vi.fn()
const toast = vi.fn()
let scope = effectScope()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function view(id = 'service-a'): ServiceConfigurationView {
  return {
    connection: {
      upstreamServiceId: id, discovered: true, availability: 'online', tokenConfigured: true,
      serviceId: id, serviceName: id, serviceVersion: '1.0', serviceCommit: null, serviceProtocol: 'openapi-service/v1',
      openapiSha256: 'openapi', configurationSchemaSha256: 'schema', configurationRevision: 4, configurationHash: 'hash',
      lastDiscoveredAt: null, lastConfigurationSyncAt: null, lastDiscoveryError: null
    },
    definition: { schemaVersion: 1, groups: [{ key: 'general', label: 'General', fields: [{ key: 'enabled', label: 'Enabled', type: 'boolean', default: true }] }] },
    values: { enabled: true }, targets: [], endpoints: []
  }
}

const payload = { expectedRevision: 4, values: { enabled: false }, secrets: { key: 'replacement' } }
const outcome: ServiceConfigurationSyncOutcome = {
  status: 'synced', revision: 5, configurationHash: 'next-hash', targets: [], routingRevision: { id: 'runtime', sequence: 99 }
}
const target = { id: 'target-a', baseUrl: 'http://service:8080', enabled: true, weight: 1 } as PlatformUpstreamTarget

function setup() {
  const id = ref('service-a')
  const service = { data: ref<ServiceConfigurationView | null>(view()), loading: ref(false), error: ref<unknown>(null), refresh: vi.fn().mockResolvedValue(undefined) }
  const upstreams = {
    data: ref<PlatformUpstream[]>([
      { id: 'service-a', name: 'Service A', targets: [target] } as PlatformUpstream,
      { id: 'service-b', name: 'Service B', targets: [] } as unknown as PlatformUpstream
    ]),
    loading: ref(false), error: ref<unknown>(null), refresh: vi.fn().mockResolvedValue(undefined)
  }
  resourceFactory.mockImplementation((options: { path: string | (() => string) }) => typeof options.path === 'function' ? service : upstreams)
  const control = scope.run(() => useAdminServiceControl(id))!
  return { control, id, service, upstreams }
}

type Control = ReturnType<typeof useAdminServiceControl>
const actions = ['discover', 'token', 'save', 'synchronize'] as const
type Action = typeof actions[number]
function invoke(control: Control, action: Action) {
  if (action === 'discover') return control.discover()
  if (action === 'save') return control.saveConfiguration(payload)
  if (action === 'synchronize') return control.synchronizeConfiguration()
  control.serviceToken.value = 't'.repeat(32)
  return control.updateServiceToken()
}

beforeEach(() => {
  scope = effectScope()
  vi.stubGlobal('useI18n', () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }))
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useConfirmDialog', () => confirm)
  confirm.mockImplementation(async (options: { onConfirm: () => Promise<void> }) => { await options.onConfirm(); return true })
  fetchMock.mockResolvedValue(outcome)
})

afterEach(() => {
  scope.stop()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('Service control', () => {
  it.each([null, 'one Target failed'])('accepts discovery and refreshes management data (error=%s)', async (lastDiscoveryError) => {
    const { control, service, upstreams } = setup()
    const result = view()
    result.connection.lastDiscoveryError = lastDiscoveryError
    result.connection.serviceVersion = '2.0'
    fetchMock.mockResolvedValueOnce(result)
    await expect(control.discover()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/upstreams/service-a/discover', { method: 'POST' })
    expect(control.view.value).toEqual(result)
    expect(control.pageFeedback.value).toEqual({
      message: lastDiscoveryError ? 'admin.apis.routing.serviceControl.discoveryPartial' : 'admin.apis.routing.serviceControl.discoverySucceeded',
      color: lastDiscoveryError ? 'warning' : 'success'
    })
    expect(upstreams.refresh).toHaveBeenCalledOnce()
    expect(service.refresh).not.toHaveBeenCalled()
  })

  it('refreshes failed discovery state without losing the operation error', async () => {
    const { control, service, upstreams } = setup()
    fetchMock.mockRejectedValueOnce(new Error('Discovery failed'))
    await expect(control.discover()).resolves.toBe(false)
    expect(control.pageFeedback.value).toEqual({ message: 'Discovery failed', color: 'error' })
    expect(service.refresh).toHaveBeenCalledOnce()
    expect(upstreams.refresh).not.toHaveBeenCalled()
    expect(control.controls.value.discoverDisabled).toBe(false)
  })

  it.each([0, 31, 4097])('validates Token length %s before sending it', async (length) => {
    const { control } = setup()
    control.serviceToken.value = 't'.repeat(length)
    await expect(control.updateServiceToken()).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(control.tokenFeedback.value).toEqual({ message: 'admin.apis.routing.validation.serviceTokenInvalid', color: 'error' })
  })

  it.each([32, 4096])('trims and saves a valid Token of length %s, then clears only its draft', async (length) => {
    const { control, service, upstreams } = setup()
    const token = 't'.repeat(length)
    control.serviceToken.value = ` ${token} `
    await expect(control.updateServiceToken()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/upstreams/service-a/token', { method: 'PUT', body: { serviceToken: token } })
    expect(control.serviceToken.value).toBe('')
    expect(control.tokenFeedback.value).toMatchObject({
      color: 'success', description: 'admin.apis.routing.serviceControl.rediscoverAfterToken'
    })
    expect(service.refresh).toHaveBeenCalledOnce()
    expect(upstreams.refresh).not.toHaveBeenCalled()
  })

  it('keeps a failed Token draft available for retry', async () => {
    const { control, service } = setup()
    control.serviceToken.value = 't'.repeat(32)
    fetchMock.mockRejectedValueOnce(new Error('Token rejected'))
    await expect(control.updateServiceToken()).resolves.toBe(false)
    expect(control.serviceToken.value).toBe('t'.repeat(32))
    expect(control.tokenFeedback.value).toEqual({ message: 'Token rejected', color: 'error' })
    expect(service.refresh).not.toHaveBeenCalled()
    await expect(control.updateServiceToken()).resolves.toBe(true)
    expect(control.serviceToken.value).toBe('')
  })

  it.each(['save', 'synchronize'] as const)('interprets all configuration outcomes consistently for %s', async (action) => {
    const { control, service } = setup()
    for (const [status, suffix, color] of [
      ['synced', 'configurationSynced', 'success'],
      ['partial', 'configurationPartial', 'warning'],
      ['failed', 'configurationFailed', 'error']
    ] as const) {
      fetchMock.mockResolvedValueOnce({ ...outcome, status })
      await expect(invoke(control, action)).resolves.toBe(true)
      const feedback = action === 'save' ? control.configurationFeedback.value : control.pageFeedback.value
      expect(feedback).toEqual({
        message: `admin.apis.routing.serviceControl.${suffix}`, color,
        ...(action === 'save' ? { description: 'admin.apis.routing.serviceControl.configurationRevision:{"revision":5}' } : {})
      })
    }
    expect(fetchMock).toHaveBeenLastCalledWith(
      action === 'save' ? '/api/admin/v1/upstreams/service-a/configuration' : '/api/admin/v1/upstreams/service-a/configuration/sync',
      action === 'save' ? { method: 'PUT', body: payload } : { method: 'POST' }
    )
    expect(service.refresh).toHaveBeenCalledTimes(3)
  })

  it('rejects synchronization before a configuration has been saved and saving without a discovered schema', async () => {
    const { control, service } = setup()
    service.data.value!.connection.configurationRevision = 0
    expect(control.controls.value.synchronizationDisabled).toBe(true)
    await expect(control.synchronizeConfiguration()).resolves.toBe(false)
    service.data.value!.definition = null
    expect(control.controls.value.configurationDisabled).toBe(true)
    await expect(control.saveConfiguration(payload)).resolves.toBe(false)
    service.data.value = view()
    service.data.value.connection.discovered = false
    expect(control.controls.value.configurationDisabled).toBe(true)
    await expect(control.saveConfiguration(payload)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(actions)('uses the same admission state while %s runs', async (action) => {
    const { control, service, upstreams } = setup()
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const operation = invoke(control, action)
    expect(control.controls.value).toMatchObject({
      discovering: action === 'discover', updatingToken: action === 'token', saving: action === 'save', synchronizing: action === 'synchronize',
      discoverDisabled: true, synchronizationDisabled: true, configurationDisabled: true, tokenInputDisabled: true, tokenUpdateDisabled: true, refreshDisabled: true
    })
    expect(control.targetOperations.state.value.disabled).toBe(true)
    for (const other of actions) await expect(invoke(control, other)).resolves.toBe(false)
    await expect(control.targetOperations.toggle(target)).resolves.toBe(false)
    await expect(control.targetOperations.remove(target)).resolves.toBe(false)
    await expect(control.targetOperations.save('service-a', target, target)).resolves.toBe(false)
    await control.refresh()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
    expect(service.refresh).not.toHaveBeenCalled()
    expect(upstreams.refresh).not.toHaveBeenCalled()
    request.resolve(action === 'discover' ? view() : outcome)
    await operation
    expect(control.controls.value.discoverDisabled).toBe(false)
    expect(control.targetOperations.state.value.disabled).toBe(false)
  })

  it('blocks Service controls through Target confirmation and cancellation', async () => {
    const { control } = setup()
    const answer = deferred<boolean>()
    confirm.mockReturnValueOnce(answer.promise)
    const operation = control.targetOperations.remove(target)
    for (const action of actions) await expect(invoke(control, action)).resolves.toBe(false)
    expect(control.controls.value.discoverDisabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    answer.resolve(false)
    await operation
    expect(control.controls.value.discoverDisabled).toBe(false)
  })

  it('blocks Service controls during Target saving and refreshes both data sources after success', async () => {
    const { control, service, upstreams } = setup()
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const operation = control.targetOperations.save('service-a', target, target)
    expect(control.controls.value.configurationDisabled).toBe(true)
    for (const action of actions) await expect(invoke(control, action)).resolves.toBe(false)
    request.resolve(target)
    await operation
    expect(service.refresh).toHaveBeenCalledOnce()
    expect(upstreams.refresh).toHaveBeenCalledOnce()
    expect(control.controls.value.discoverDisabled).toBe(false)
  })

  it.each(['service', 'upstreams'] as const)('blocks mutations while the %s resource is loading', async (resourceName) => {
    const context = setup()
    context[resourceName].loading.value = true
    expect(context.control.loading.value).toBe(true)
    for (const action of actions) await expect(invoke(context.control, action)).resolves.toBe(false)
    expect(context.control.targetOperations.state.value.disabled).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps controls disabled through a post-mutation refresh', async () => {
    const { control, service } = setup()
    const read = deferred<undefined>()
    service.refresh.mockReturnValueOnce(read.promise)
    const operation = control.saveConfiguration(payload)
    await vi.waitFor(() => expect(service.refresh).toHaveBeenCalledOnce())
    expect(control.controls.value.saving).toBe(true)
    expect(control.controls.value.discoverDisabled).toBe(true)
    read.resolve(undefined)
    await operation
    expect(control.controls.value.discoverDisabled).toBe(false)
  })

  it('preserves a completed save outcome while separately exposing a read failure', async () => {
    const { control, service } = setup()
    const error = new Error('Read failed')
    service.refresh.mockResolvedValueOnce({ status: 'error', error: error })
    await expect(control.saveConfiguration(payload)).resolves.toBe(true)
    expect(control.configurationFeedback.value?.color).toBe('success')
    expect(control.loadError.value).toBe(error)
    expect(fetchMock).toHaveBeenCalledOnce()
    await control.refresh()
    expect(control.loadError.value).toBeNull()
  })

  it.each(['save', 'synchronize'] as const)('keeps %s request failures in the correct feedback region', async (action) => {
    const { control, service } = setup()
    fetchMock.mockRejectedValueOnce({})
    await expect(invoke(control, action)).resolves.toBe(false)
    expect(action === 'save' ? control.configurationFeedback.value : control.pageFeedback.value).toEqual({
      message: action === 'save' ? 'admin.apis.routing.serviceControl.configurationSaveFailed' : 'admin.apis.routing.serviceControl.configurationSyncFailed', color: 'error'
    })
    expect(service.refresh).not.toHaveBeenCalled()
    expect(control.controls.value.discoverDisabled).toBe(false)
  })

  it.each(actions.flatMap(action => [
    { action, failed: false }, { action, failed: true }
  ]))('ignores an old $action result (failed=$failed) without releasing the new operation', async ({ action, failed }) => {
    const { control, id, service, upstreams } = setup()
    const old = deferred<unknown>()
    fetchMock.mockReturnValueOnce(old.promise)
    const oldOperation = invoke(control, action)
    id.value = 'service-b'
    expect(control.view.value).toBeNull()
    expect(control.serviceToken.value).toBe('')
    service.data.value = view('service-b')
    control.serviceToken.value = 'new-draft'
    const current = deferred<unknown>()
    fetchMock.mockReturnValueOnce(current.promise)
    const newOperation = control.discover()
    if (failed) old.reject(new Error('Old error'))
    else old.resolve(action === 'discover' ? view() : outcome)
    await expect(oldOperation).resolves.toBe(false)
    expect(control.view.value?.connection.upstreamServiceId).toBe('service-b')
    expect(control.managementUpstream.value?.id).toBe('service-b')
    expect(control.serviceToken.value).toBe('new-draft')
    expect(control.controls.value.discovering).toBe(true)
    expect(control.pageFeedback.value).toBeNull()
    expect(control.configurationFeedback.value).toBeNull()
    expect(control.tokenFeedback.value).toBeNull()
    expect(service.refresh).toHaveBeenCalledOnce()
    expect(upstreams.refresh).toHaveBeenCalledOnce()
    current.resolve(view('service-b'))
    await expect(newOperation).resolves.toBe(true)
    expect(control.controls.value.discovering).toBe(false)
  })

  it('invalidates old responses even when returning to the same Service ID', async () => {
    const { control, id, service } = setup()
    const old = deferred<unknown>()
    fetchMock.mockReturnValueOnce(old.promise)
    const operation = control.discover()
    id.value = 'service-b'
    id.value = 'service-a'
    const fresh = view()
    fresh.connection.serviceVersion = 'fresh'
    service.data.value = fresh
    old.resolve(view())
    await expect(operation).resolves.toBe(false)
    expect(control.view.value?.connection.serviceVersion).toBe('fresh')
    expect(control.pageFeedback.value).toBeNull()
  })

  it('preserves ordinary and Secret drafts across availability refreshes, then resets them on a saved Revision', async () => {
    const { control, service } = setup()
    service.data.value!.definition!.groups[0]!.fields.push({ key: 'credential', label: 'Credential', type: 'secret' })
    service.data.value!.values.credential = { configured: true }
    const form = scope.run(() => useAdminServiceConfigurationForm(() => control.view.value!))!
    form.setValue('enabled', false)
    form.setSecret('credential', 'new-secret-draft')
    service.refresh.mockImplementationOnce(async () => {
      service.data.value = { ...service.data.value!, connection: { ...service.data.value!.connection, availability: 'degraded' } }
    })
    await control.refresh()
    await nextTick()
    expect(form.payload()).toEqual({ expectedRevision: 4, values: { enabled: false }, secrets: { credential: 'new-secret-draft' } })
    service.refresh.mockImplementationOnce(async () => {
      service.data.value = {
        ...service.data.value!, connection: { ...service.data.value!.connection, configurationRevision: 5 },
        values: { enabled: false, credential: { configured: true } }
      }
    })
    await control.saveConfiguration(form.payload())
    await nextTick()
    expect(form.pendingChangeCount.value).toBe(0)
    expect(form.secretValues.credential).toBe('')
    expect(form.payload()).toEqual({ expectedRevision: 5, values: { enabled: false }, secrets: {} })
  })

  it('ignores refresh errors from a completed operation in the previous Service context', async () => {
    const { control, id, service } = setup()
    const read = deferred<undefined>()
    service.refresh.mockReturnValueOnce(read.promise)
    const operation = control.saveConfiguration(payload)
    await vi.waitFor(() => expect(service.refresh).toHaveBeenCalledOnce())
    id.value = 'service-b'
    service.data.value = view('service-b')
    read.reject(new Error('Old read failed'))
    await expect(operation).resolves.toBe(false)
    expect(control.loadError.value).toBeNull()
    expect(control.configurationFeedback.value).toBeNull()
    expect(control.view.value?.connection.upstreamServiceId).toBe('service-b')
  })

  it('drops late results and clears sensitive drafts after disposal', async () => {
    const { control, upstreams } = setup()
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    control.serviceToken.value = 'draft'
    const operation = control.discover()
    scope.stop()
    request.resolve(view())
    await expect(operation).resolves.toBe(false)
    expect(control.serviceToken.value).toBe('')
    expect(control.pageFeedback.value).toBeNull()
    expect(control.controls.value.discoverDisabled).toBe(true)
    expect(upstreams.refresh).not.toHaveBeenCalled()
  })
})
