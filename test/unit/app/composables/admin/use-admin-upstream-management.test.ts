import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformUpstream, PlatformUpstreamTarget } from '#shared/types/platform'
import type { ConfirmDialogOptions } from '~/composables/use-confirm-dialog'
import { useAdminUpstreamManagement } from '~/composables/admin/use-admin-upstream-management'

const { paged } = vi.hoisted(() => ({ paged: vi.fn() }))
vi.mock('~/composables/dashboard/use-private-paged-list', () => ({ usePrivatePagedList: paged }))
const fetchMock = vi.fn()
const toast = vi.fn()
const confirm = vi.fn()
let scope = effectScope()
let dialog: { options: ConfirmDialogOptions, resolve: (value: boolean) => void }
const target = { id: 'target-1', baseUrl: 'http://service:8080', enabled: true, weight: 1 } as PlatformUpstreamTarget
const upstream = { id: 'upstream-1', name: 'Service', status: 'active', targets: [target] } as PlatformUpstream
const targetValues = { baseUrl: 'http://updated:8080', weight: 3, enabled: false }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function setup() {
  const resource = {
    items: ref([upstream]), page: ref(1), pageSize: ref(20), total: ref(1),
    loading: ref(false), error: ref<unknown>(null),
    refresh: vi.fn().mockResolvedValue({ status: 'success', data: { items: [upstream], total: 1 } })
  }
  paged.mockReturnValue(resource)
  const management = scope.run(useAdminUpstreamManagement)!
  return { management, resource }
}

beforeEach(() => {
  scope = effectScope()
  vi.stubGlobal('useI18n', () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }))
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useConfirmDialog', () => confirm)
  vi.stubGlobal('$fetch', fetchMock)
  fetchMock.mockResolvedValue({})
  confirm.mockImplementation(options => new Promise<boolean>((resolve) => { dialog = { options, resolve } }))
})

afterEach(() => { scope.stop(); vi.resetAllMocks(); vi.unstubAllGlobals() })

describe('Upstream list management', () => {
  it.each(['active', 'disabled'] as const)('freezes the confirmed identifier and intended status for %s Upstreams', async (status) => {
    const { management, resource } = setup()
    const current = { ...upstream, status }
    const pending = management.toggleUpstream(current)
    expect(dialog.options).toMatchObject({
      title: 'admin.apis.routing.toggleUpstream.title:{"name":"Service"}',
      description: 'admin.apis.routing.toggleUpstream.description',
      confirmLabel: status === 'active' ? 'common.actions.disable' : 'common.actions.enable',
      confirmColor: status === 'active' ? 'warning' : 'primary'
    })
    expect(fetchMock).not.toHaveBeenCalled()
    current.id = 'replacement'
    current.status = status === 'active' ? 'disabled' : 'active'
    await dialog.options.onConfirm!()
    dialog.resolve(true)
    await expect(pending).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/upstreams/upstream-1', {
      method: 'PATCH', body: { status: status === 'active' ? 'disabled' : 'active' }
    })
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'common.feedback.updated', color: 'success' })
    expect(resource.refresh).toHaveBeenCalledOnce()
    expect(management.controls.value.disabled).toBe(false)
  })

  it('reserves the list from deletion confirmation through refresh and never replays a completed delete', async () => {
    const { management, resource } = setup()
    const request = deferred<unknown>()
    const read = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    resource.refresh.mockReturnValueOnce(read.promise)
    const current = { ...upstream }
    const pending = management.removeUpstream(current)
    expect(dialog.options).toMatchObject({
      title: 'admin.apis.routing.deleteUpstream.title:{"name":"Service"}',
      description: 'admin.apis.routing.deleteUpstream.description',
      confirmColor: 'error'
    })
    const callback = dialog.options.onConfirm!

    async function expectBlocked() {
      expect(management.controls.value).toEqual({ disabled: true, refreshDisabled: true })
      expect(management.targetState.value.disabled).toBe(true)
      await expect(management.toggleUpstream(upstream)).resolves.toBe(false)
      await expect(management.removeUpstream(upstream)).resolves.toBe(false)
      await expect(management.toggleTarget(target)).resolves.toBe(false)
      await expect(management.removeTarget(target)).resolves.toBe(false)
      management.openCreateUpstream()
      management.openEditUpstream(upstream)
      management.openTarget(upstream, target)
      expect(management.modalOpen.value).toBe(false)
      expect(management.targetModalOpen.value).toBe(false)
      await management.refresh()
      expect(confirm).toHaveBeenCalledOnce()
    }

    await expectBlocked()
    expect(resource.refresh).not.toHaveBeenCalled()
    current.id = 'replacement'
    const executing = callback()
    expect(callback()).toBe(executing)
    await expectBlocked()
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/upstreams/upstream-1', { method: 'DELETE' })
    request.resolve({})
    await vi.waitFor(() => expect(resource.refresh).toHaveBeenCalledOnce())
    await expectBlocked()
    expect(callback()).toBe(executing)
    read.resolve({ status: 'success', data: { items: [], total: 0 } })
    await executing
    await callback()
    dialog.resolve(true)
    await expect(pending).resolves.toBe(true)
    await callback()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(resource.refresh).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'common.feedback.deleted', color: 'success' })
    expect(management.controls.value).toEqual({ disabled: false, refreshDisabled: false })
  })

  it.each(['toggleUpstream', 'removeUpstream'] as const)('invalidates retained %s callbacks after cancellation and permits a new confirmation', async (action) => {
    const { management, resource } = setup()
    const pending = management[action](upstream)
    const oldDialog = dialog
    oldDialog.resolve(false)
    await expect(pending).resolves.toBe(false)
    const next = management[action](upstream)
    await oldDialog.options.onConfirm!()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resource.refresh).not.toHaveBeenCalled()
    expect(management.controls.value.disabled).toBe(true)
    await dialog.options.onConfirm!()
    dialog.resolve(true)
    await expect(next).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each(['toggleUpstream', 'removeUpstream'] as const)('invalidates %s callbacks and other entry points on disposal', async (action) => {
    const { management, resource } = setup()
    const pending = management[action](upstream)
    scope.stop()
    await dialog.options.onConfirm!()
    dialog.resolve(true)
    await expect(pending).resolves.toBe(false)
    await expect(management[action](upstream)).resolves.toBe(false)
    await management.refresh()
    management.openCreateUpstream()
    management.openTarget(upstream, target)
    expect(management.modalOpen.value).toBe(false)
    expect(management.targetModalOpen.value).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resource.refresh).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it.each([
    ['toggleUpstream', false], ['toggleUpstream', true],
    ['removeUpstream', false], ['removeUpstream', true]
  ] as const)('ignores late %s effects after disposal (rejected=%s)', async (action, rejected) => {
    const { management, resource } = setup()
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const pending = management[action](upstream)
    const executing = dialog.options.onConfirm!()
    scope.stop()
    if (rejected) {
      const result = expect(executing).rejects.toThrow('late failure')
      request.reject(new Error('late failure'))
      await result
    } else {
      request.resolve({})
      await executing
    }
    dialog.resolve(true)
    await expect(pending).resolves.toBe(false)
    expect(resource.refresh).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it.each(['toggleUpstream', 'removeUpstream'] as const)('allows failed %s mutations to retry in the same confirmation', async (action) => {
    const { management, resource } = setup()
    const error = action === 'removeUpstream'
      ? { data: { message: 'remove every route before deleting the upstream', data: { code: 'UPSTREAM_STILL_PUBLISHED' } } }
      : {}
    fetchMock.mockRejectedValueOnce(error)
    const pending = management[action](upstream)
    await expect(dialog.options.onConfirm!()).rejects.toBe(error)
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      title: action === 'removeUpstream' ? 'admin.apis.routing.deleteUpstream.stillPublished' : 'common.feedback.operationFailed', color: 'error'
    })
    expect(management.controls.value.disabled).toBe(true)
    expect(resource.refresh).not.toHaveBeenCalled()
    await dialog.options.onConfirm!()
    dialog.resolve(true)
    await expect(pending).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(resource.refresh).toHaveBeenCalledOnce()
  })

  it.each([
    ['toggleUpstream', false], ['toggleUpstream', true],
    ['removeUpstream', false], ['removeUpstream', true]
  ] as const)('keeps successful %s mutations completed when refresh fails (thrown=%s)', async (action, thrown) => {
    const { management, resource } = setup()
    if (thrown) resource.refresh.mockRejectedValueOnce({})
    else resource.refresh.mockResolvedValueOnce({ status: 'error', error: {} })
    const pending = management[action](upstream)
    await dialog.options.onConfirm!()
    await dialog.options.onConfirm!()
    dialog.resolve(true)
    await expect(pending).resolves.toBe(true)
    expect(toast.mock.calls.map(call => call[0])).toEqual([
      { title: action === 'removeUpstream' ? 'common.feedback.deleted' : 'common.feedback.updated', color: 'success' },
      { title: 'common.feedback.loadFailed', color: 'error' }
    ])
    await management.refresh()
    expect(resource.refresh).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('ignores refresh failure feedback after disposal', async () => {
    const { management, resource } = setup()
    const read = deferred<unknown>()
    resource.refresh.mockReturnValueOnce(read.promise)
    const pending = management.removeUpstream(upstream)
    const executing = dialog.options.onConfirm!()
    await vi.waitFor(() => expect(resource.refresh).toHaveBeenCalledOnce())
    scope.stop()
    read.resolve({ status: 'error', error: {} })
    await executing
    dialog.resolve(true)
    await expect(pending).resolves.toBe(false)
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'common.feedback.deleted', color: 'success' })
  })

  it.each(['loading', 'error'] as const)('blocks writes during list %s but allows recovery after a read error', async (state) => {
    const { management, resource } = setup()
    if (state === 'loading') resource.loading.value = true
    else resource.error.value = new Error('read failed')
    expect(management.controls.value.disabled).toBe(true)
    await expect(management.removeUpstream(upstream)).resolves.toBe(false)
    await expect(management.toggleUpstream(upstream)).resolves.toBe(false)
    await expect(management.removeTarget(target)).resolves.toBe(false)
    management.openCreateUpstream()
    management.openEditUpstream(upstream)
    management.openTarget(upstream, target)
    expect(management.modalOpen.value).toBe(false)
    expect(management.targetModalOpen.value).toBe(false)
    await management.refresh()
    expect(resource.refresh).toHaveBeenCalledTimes(state === 'error' ? 1 : 0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it.each(['upstream', 'target'] as const)('reserves the list while the %s editor is open without blocking its Target save', async (editor) => {
    const { management } = setup()
    if (editor === 'upstream') management.openEditUpstream(upstream)
    else management.openTarget(upstream, target)
    await expect(management.removeUpstream(upstream)).resolves.toBe(false)
    await expect(management.toggleUpstream(upstream)).resolves.toBe(false)
    await expect(management.removeTarget(target)).resolves.toBe(false)
    await expect(management.toggleTarget(target)).resolves.toBe(false)
    management.openCreateUpstream()
    management.openTarget(upstream)
    management.openEditUpstream(upstream)
    expect(management.modalOpen.value).toBe(editor === 'upstream')
    expect(management.targetModalOpen.value).toBe(editor === 'target')
    await expect(management.saveTarget(upstream.id, target, targetValues)).resolves.toBe(editor === 'target')
    expect(fetchMock).toHaveBeenCalledTimes(editor === 'target' ? 1 : 0)
    expect(confirm).not.toHaveBeenCalled()
    management.modalOpen.value = false
    management.targetModalOpen.value = false
    expect(management.editingUpstream.value).toBeNull()
    expect(management.targetUpstream.value).toBeNull()
    expect(management.editingTarget.value).toBeNull()
    await expect(management.saveTarget(upstream.id, target, targetValues)).resolves.toBe(false)
    expect(management.controls.value.disabled).toBe(false)
  })

  it('creates a Target only for the currently open editor', async () => {
    const { management } = setup()
    management.openTarget(upstream)
    await expect(management.saveTarget('another-upstream', null, targetValues)).resolves.toBe(false)
    await expect(management.saveTarget(upstream.id, target, targetValues)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(management.saveTarget(upstream.id, null, targetValues)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/upstreams/upstream-1/targets', {
      method: 'POST', body: targetValues
    })
  })

  it.each(['confirmation', 'save'] as const)('blocks Upstream actions throughout a Target %s and its refresh', async (kind) => {
    const { management, resource } = setup()
    const read = deferred<unknown>()
    resource.refresh.mockReturnValueOnce(read.promise)
    if (kind === 'save') management.openTarget(upstream, target)
    const pending = kind === 'save'
      ? management.saveTarget(upstream.id, target, targetValues)
      : management.removeTarget(target)
    expect(management.controls.value.disabled).toBe(true)
    await expect(management.removeUpstream(upstream)).resolves.toBe(false)
    const executing = kind === 'confirmation' ? dialog.options.onConfirm!() : undefined
    await vi.waitFor(() => expect(resource.refresh).toHaveBeenCalledOnce())
    await expect(management.toggleUpstream(upstream)).resolves.toBe(false)
    management.openEditUpstream(upstream)
    expect(management.modalOpen.value).toBe(false)
    await management.refresh()
    expect(resource.refresh).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
    read.resolve({ status: 'success', data: { items: [upstream], total: 1 } })
    await executing
    if (kind === 'confirmation') dialog.resolve(true)
    await expect(pending).resolves.toBe(true)
    management.targetModalOpen.value = false
    expect(management.controls.value.disabled).toBe(false)
  })

  it('keeps Target edit context after failed reads and reconciles it after successful reads', async () => {
    const { management, resource } = setup()
    management.openTarget(upstream, target)
    resource.error.value = new Error('read failed')
    resource.items.value = []
    await nextTick()
    expect(management.targetModalOpen.value).toBe(true)
    expect(management.editingTarget.value?.id).toBe(target.id)
    const updated = { ...target, weight: 5 }
    resource.error.value = null
    resource.items.value = [{ ...upstream, targets: [updated] }]
    await nextTick()
    expect(management.editingTarget.value?.weight).toBe(5)
    resource.items.value = [{ ...upstream, targets: [] }]
    await nextTick()
    expect(management.targetModalOpen.value).toBe(false)
    expect(management.targetUpstream.value).toBeNull()
    expect(management.editingTarget.value).toBeNull()
  })
})
