import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformUpstreamTarget } from '#shared/types/platform'
import { useAdminTargetOperations, type TargetFormValues } from '~/composables/admin/use-admin-target-operations'

const fetchMock = vi.fn()
const refresh = vi.fn()
const toast = vi.fn()
const confirm = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

interface ConfirmationOptions {
  title: string
  confirmLabel?: string
  confirmColor: string
  onConfirm: () => Promise<void> | void
}

let dialog: { options: ConfirmationOptions, resolve: (answer: boolean) => void }

const target = { id: 'target-1', baseUrl: 'http://service:8080', enabled: true, weight: 1 } as PlatformUpstreamTarget
const values: TargetFormValues = { baseUrl: '  http://updated:8080  ', weight: 3, enabled: false }

function setup() {
  const blocked = ref(false)
  const operations = useAdminTargetOperations({ refresh, isBlocked: () => blocked.value })
  return { operations, blocked }
}

beforeEach(() => {
  vi.stubGlobal('useI18n', () => ({ t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key }))
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useConfirmDialog', () => confirm)
  vi.stubGlobal('$fetch', fetchMock)
  fetchMock.mockResolvedValue(target)
  refresh.mockResolvedValue(undefined)
  confirm.mockImplementation((options: ConfirmationOptions) => new Promise<boolean>((resolve) => {
    dialog = { options, resolve }
  }))
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('Target operations', () => {
  it('invalidates a retained confirmation callback when its owner is disposed', async () => {
    const scope = effectScope()
    const { operations } = scope.run(setup)!
    const pending = operations.remove(target)
    scope.stop()
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(pending).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not execute a confirmation for an Upstream that is no longer selected', async () => {
    const scope = effectScope()
    const upstreamId = ref('first')
    const operations = scope.run(() => useAdminTargetOperations({ refresh, isBlocked: () => false, context: () => upstreamId.value }))!
    const pending = operations.remove(target)
    upstreamId.value = 'second'
    upstreamId.value = 'first'
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(pending).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    scope.stop()
  })

  it('ignores a save response after the owning scope is disposed', async () => {
    const scope = effectScope()
    const { operations } = scope.run(setup)!
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const pending = operations.save('upstream-1', target, values)
    scope.stop()
    request.resolve(target)
    await expect(pending).resolves.toBe(false)
    expect(refresh).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
  it.each([null, target])('saves %s through the shared flow, normalizes the address and refreshes once', async (editing) => {
    const { operations } = setup()
    await expect(operations.save('upstream-1', editing, values)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      editing ? '/api/admin/v1/targets/target-1' : '/api/admin/v1/upstreams/upstream-1/targets',
      { method: editing ? 'PATCH' : 'POST', body: { ...values, baseUrl: 'http://updated:8080' } }
    )
    expect(values.baseUrl).toBe('  http://updated:8080  ')
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      title: editing ? 'admin.apis.routing.feedback.targetUpdated' : 'admin.apis.routing.feedback.targetCreated', color: 'success'
    })
    expect(refresh).toHaveBeenCalledOnce()
    expect(operations.state.value).toEqual({ busy: false, saving: false, disabled: false })
  })

  it('returns failure so the editor stays open and permits a later save retry', async () => {
    const { operations } = setup()
    fetchMock.mockRejectedValueOnce({ data: { message: 'Target address rejected' } })
    await expect(operations.save('upstream-1', target, values)).resolves.toBe(false)
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'Target address rejected', color: 'error' })
    expect(refresh).not.toHaveBeenCalled()
    expect(operations.state.value.saving).toBe(false)
    expect(operations.state.value.disabled).toBe(false)
    await expect(operations.save('upstream-1', target, values)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('holds save state through the refresh and refuses overlapping operations', async () => {
    const { operations } = setup()
    const read = deferred<undefined>()
    refresh.mockReturnValueOnce(read.promise)
    const saving = operations.save('upstream-1', target, values)
    expect(operations.state.value).toEqual({ busy: true, saving: true, disabled: true })
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce())
    await expect(operations.save('upstream-1', null, values)).resolves.toBe(false)
    await expect(operations.toggle(target)).resolves.toBe(false)
    await expect(operations.remove(target)).resolves.toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(operations.state.value.saving).toBe(true)
    read.resolve(undefined)
    await expect(saving).resolves.toBe(true)
    expect(operations.state.value.busy).toBe(false)
  })

  it('uses the supplied blocked state for both admission and displayed controls', async () => {
    const { operations, blocked } = setup()
    blocked.value = true
    expect(operations.state.value).toEqual({ busy: false, saving: false, disabled: true })
    await expect(operations.save('upstream-1', null, values)).resolves.toBe(false)
    await expect(operations.toggle(target)).resolves.toBe(false)
    await expect(operations.remove(target)).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
    blocked.value = false
    expect(operations.state.value.disabled).toBe(false)
  })

  it.each([true, false])('confirms the intended toggle when enabled=%s', async (enabled) => {
    const { operations } = setup()
    const current = { ...target, enabled }
    const operation = operations.toggle(current)
    expect(operations.state.value).toEqual({ busy: true, saving: false, disabled: true })
    expect(dialog.options).toMatchObject({
      title: 'admin.apis.routing.toggleTarget.title:{"name":"http://service:8080"}',
      confirmLabel: enabled ? 'common.actions.disable' : 'common.actions.enable',
      confirmColor: enabled ? 'warning' : 'primary'
    })
    expect(fetchMock).not.toHaveBeenCalled()
    // A refreshed row must not change the action the user was asked to confirm.
    current.enabled = !enabled
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(operation).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/targets/target-1', { method: 'PATCH', body: { enabled: !enabled } })
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'common.feedback.updated', color: 'success' })
    expect(refresh).toHaveBeenCalledOnce()
    expect(operations.state.value.busy).toBe(false)
  })

  it('confirms deletion and reports its success consistently', async () => {
    const { operations } = setup()
    const operation = operations.remove(target)
    expect(dialog.options).toMatchObject({ title: 'admin.apis.routing.deleteTarget.title', confirmColor: 'error' })
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(operation).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/targets/target-1', { method: 'DELETE' })
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'common.feedback.deleted', color: 'success' })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it.each(['toggle', 'remove'] as const)('cancels %s without mutation and releases its reservation', async (action) => {
    const { operations } = setup()
    const operation = operations[action](target)
    await expect(operations.save('upstream-1', target, values)).resolves.toBe(false)
    await expect(operations.toggle(target)).resolves.toBe(false)
    await expect(operations.remove(target)).resolves.toBe(false)
    expect(confirm).toHaveBeenCalledOnce()
    dialog.resolve(false)
    await expect(operation).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(operations.state.value.busy).toBe(false)
  })

  it.each(['toggle', 'remove'] as const)('keeps failed %s confirmation open for retry', async (action) => {
    const { operations } = setup()
    const failure = new Error('Mutation failed')
    fetchMock.mockRejectedValueOnce(failure)
    const operation = operations[action](target)
    await expect(dialog.options.onConfirm()).rejects.toThrow('Mutation failed')
    expect(refresh).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'Mutation failed', color: 'error' })
    expect(operations.state.value.busy).toBe(true)
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(operation).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledOnce()
    expect(operations.state.value.disabled).toBe(false)
  })

  it('releases a failed confirmation when the user cancels instead of retrying', async () => {
    const { operations } = setup()
    fetchMock.mockRejectedValueOnce(new Error('Target still referenced'))
    const operation = operations.remove(target)
    await expect(dialog.options.onConfirm()).rejects.toThrow('Target still referenced')
    dialog.resolve(false)
    await expect(operation).resolves.toBe(false)
    expect(operations.state.value.disabled).toBe(false)
  })

  it('does not send multiple mutations for repeated confirmation clicks', async () => {
    const { operations } = setup()
    const request = deferred<unknown>()
    fetchMock.mockReturnValueOnce(request.promise)
    const operation = operations.remove(target)
    const first = dialog.options.onConfirm()
    const second = dialog.options.onConfirm()
    expect(fetchMock).toHaveBeenCalledOnce()
    request.resolve(target)
    await Promise.all([first, second])
    await dialog.options.onConfirm()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledOnce()
    dialog.resolve(true)
    await operation
  })

  it.each(['save', 'toggle', 'remove'] as const)('keeps successful %s distinct from refresh failure', async (action) => {
    const { operations } = setup()
    refresh.mockResolvedValueOnce({ status: 'error', error: new Error('Read failed') })
    const operation = action === 'save'
      ? operations.save('upstream-1', target, values)
      : operations[action](target)
    if (action !== 'save') {
      await dialog.options.onConfirm()
      dialog.resolve(true)
    }
    await expect(operation).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(toast.mock.calls.map(call => call[0].color)).toEqual(['success', 'error'])
    expect(toast).toHaveBeenLastCalledWith({ title: 'Read failed', color: 'error' })
    expect(operations.state.value.disabled).toBe(false)
  })

  it('releases admission if opening the confirmation fails', async () => {
    const { operations } = setup()
    confirm.mockRejectedValueOnce(new Error('Dialog failed'))
    await expect(operations.toggle(target)).rejects.toThrow('Dialog failed')
    expect(operations.state.value.busy).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
