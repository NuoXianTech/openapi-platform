import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformRoutingRevisionSummary, PlatformRuntime } from '#shared/types/platform'
import { useAdminRuntimeManagement } from '~/composables/admin/use-admin-runtime-management'

const { resource, paged } = vi.hoisted(() => ({ resource: vi.fn(), paged: vi.fn() }))
vi.mock('~/composables/dashboard/use-private-resource', () => ({ usePrivateResource: resource }))
vi.mock('~/composables/dashboard/use-private-paged-list', () => ({ usePrivatePagedList: paged }))
const fetchMock = vi.fn()
const toast = vi.fn()
const confirm = vi.fn()
let scope = effectScope()
let dialog: { options: { onConfirm: () => Promise<void> | void }, resolve: (value: boolean) => void }
const revision = { id: 'old', sequence: 5 } as PlatformRoutingRevisionSummary
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function setup() {
  const runtime = {
    data: ref<PlatformRuntime>({ defaultDomain: 'old.test', activeRevisionId: 'current', updatedAt: '' }),
    loading: ref(false), error: ref<unknown>(null), refresh: vi.fn().mockResolvedValue(undefined)
  }
  const revisions = { items: ref([revision]), page: ref(1), pageSize: ref(20), total: ref(1), loading: ref(false), error: ref(null), refresh: vi.fn().mockResolvedValue(undefined) }
  resource.mockReturnValue(runtime)
  paged.mockReturnValue(revisions)
  const management = scope.run(useAdminRuntimeManagement)!
  return { management, runtime, revisions }
}
beforeEach(() => {
  scope = effectScope()
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useConfirmDialog', () => confirm)
  vi.stubGlobal('$fetch', fetchMock)
  confirm.mockImplementation(options => new Promise<boolean>((resolve) => { dialog = { options, resolve } }))
})
afterEach(() => { scope.stop(); vi.resetAllMocks(); vi.unstubAllGlobals() })

describe('Runtime management', () => {
  it.each([null, { id: 'new' }])('saves a normalized domain and interprets revision %s', async (published) => {
    const { management, runtime, revisions } = setup()
    management.domainState.defaultDomain = ' new.test '
    fetchMock.mockResolvedValue({ defaultDomain: 'new.test', activeRevisionId: 'current', updatedAt: '', revision: published })
    await expect(management.saveDomain()).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/runtime', { method: 'PATCH', body: { defaultDomain: 'new.test' } })
    expect(management.domainDirty.value).toBe(false)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ description: published ? 'admin.apis.routing.feedback.runtimeUpdated' : 'admin.apis.routing.feedback.runtimeUnchanged' }))
    expect(runtime.refresh).toHaveBeenCalledOnce()
    expect(revisions.refresh).toHaveBeenCalledOnce()
  })

  it('clears a domain with null and refuses saving an unchanged domain', async () => {
    const { management } = setup()
    await expect(management.saveDomain()).resolves.toBe(false)
    management.domainState.defaultDomain = ' '
    fetchMock.mockResolvedValue({ defaultDomain: null, activeRevisionId: 'current', updatedAt: '', revision: null })
    await management.saveDomain()
    expect(fetchMock.mock.calls[0]?.[1].body).toEqual({ defaultDomain: null })
  })

  it('blocks activation and duplicate saves until the post-save read completes', async () => {
    const { management, runtime } = setup()
    const reading = deferred<undefined>()
    runtime.refresh.mockReturnValueOnce(reading.promise)
    management.domainState.defaultDomain = 'new.test'
    fetchMock.mockResolvedValue({ defaultDomain: 'new.test', activeRevisionId: 'current', updatedAt: '', revision: null })
    const saving = management.saveDomain()
    await vi.waitFor(() => expect(runtime.refresh).toHaveBeenCalledOnce())
    expect(management.controls.value.savingDomain).toBe(true)
    await expect(management.activateRevision(revision)).resolves.toBe(false)
    await expect(management.saveDomain()).resolves.toBe(false)
    await management.refresh()
    expect(runtime.refresh).toHaveBeenCalledOnce()
    expect(confirm).not.toHaveBeenCalled()
    reading.resolve(undefined)
    await saving
    expect(management.controls.value.disabled).toBe(false)
  })

  it('preserves dirty drafts across refresh and adopts server changes when pristine', async () => {
    const { management, runtime } = setup()
    expect(management.domainState.defaultDomain).toBe('old.test')
    runtime.data.value = { ...runtime.data.value, defaultDomain: 'remote.test' }
    expect(management.domainState.defaultDomain).toBe('remote.test')
    management.domainState.defaultDomain = 'draft.test'
    runtime.data.value = { ...runtime.data.value, defaultDomain: 'another.test' }
    await nextTick()
    expect(management.domainState.defaultDomain).toBe('draft.test')
  })

  it.each(['later.test', 'old.test'])('does not erase a new draft of %s entered while a save was in flight', async (draft) => {
    const { management } = setup()
    const pending = deferred<unknown>()
    fetchMock.mockReturnValueOnce(pending.promise)
    management.domainState.defaultDomain = 'submitted.test'
    const saving = management.saveDomain()
    management.domainState.defaultDomain = draft
    pending.resolve({ defaultDomain: 'submitted.test', activeRevisionId: 'current', updatedAt: '', revision: null })
    await saving
    expect(management.domainState.defaultDomain).toBe(draft)
    expect(management.domainDirty.value).toBe(true)
  })

  it('preserves the draft after a failed save and allows retry', async () => {
    const { management } = setup()
    management.domainState.defaultDomain = 'draft.test'
    fetchMock.mockRejectedValueOnce(new Error('failed'))
    await expect(management.saveDomain()).resolves.toBe(false)
    expect(management.domainState.defaultDomain).toBe('draft.test')
    expect(management.controls.value.disabled).toBe(false)
    fetchMock.mockResolvedValue({ defaultDomain: 'draft.test', activeRevisionId: 'current', updatedAt: '', revision: null })
    await expect(management.saveDomain()).resolves.toBe(true)
  })

  it('keeps confirmation occupied, cancels without mutation, and ignores expired callbacks', async () => {
    const { management } = setup()
    const activating = management.activateRevision(revision)
    const old = dialog.options
    management.domainState.defaultDomain = 'draft.test'
    await expect(management.saveDomain()).resolves.toBe(false)
    await expect(management.activateRevision(revision)).resolves.toBe(false)
    dialog.resolve(false)
    await expect(activating).resolves.toBe(false)
    await old.onConfirm()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(management.controls.value.disabled).toBe(false)
  })

  it('retries a failed activation in the same dialog and deduplicates confirmation callbacks', async () => {
    const { management, runtime } = setup()
    const activating = management.activateRevision(revision)
    fetchMock.mockRejectedValueOnce(new Error('failed'))
    await expect(dialog.options.onConfirm()).rejects.toThrow('failed')
    expect(management.controls.value.disabled).toBe(true)
    const pending = deferred<undefined>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const one = dialog.options.onConfirm()
    const two = dialog.options.onConfirm()
    expect(one).toBe(two)
    pending.resolve(undefined)
    await one
    await dialog.options.onConfirm()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(runtime.data.value.activeRevisionId).toBe('old')
    dialog.resolve(true)
    await expect(activating).resolves.toBe(true)
    await expect(management.activateRevision(revision)).resolves.toBe(false)
  })

  it('does not replay an activation after a refresh failure', async () => {
    const { management, runtime } = setup()
    runtime.refresh.mockResolvedValueOnce({ status: 'error', error: new Error('read failed') })
    fetchMock.mockResolvedValue({})
    const activating = management.activateRevision(revision)
    await dialog.options.onConfirm()
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(activating).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(toast.mock.calls.map(call => call[0].color)).toEqual(['success', 'error'])
  })

  it('blocks mutations while runtime is loading or unavailable but permits refresh', async () => {
    const { management, runtime } = setup()
    management.domainState.defaultDomain = 'draft.test'
    runtime.loading.value = true
    await expect(management.saveDomain()).resolves.toBe(false)
    runtime.loading.value = false
    runtime.error.value = new Error('unavailable')
    await expect(management.activateRevision(revision)).resolves.toBe(false)
    await management.refresh()
    expect(runtime.refresh).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores save responses and denies later actions after disposal', async () => {
    const { management, runtime } = setup()
    const pending = deferred<unknown>()
    fetchMock.mockReturnValueOnce(pending.promise)
    management.domainState.defaultDomain = 'draft.test'
    const saving = management.saveDomain()
    scope.stop()
    pending.resolve({ defaultDomain: 'draft.test', activeRevisionId: 'new', revision: null })
    await expect(saving).resolves.toBe(false)
    expect(toast).not.toHaveBeenCalled()
    expect(runtime.refresh).not.toHaveBeenCalled()
    expect(runtime.data.value.activeRevisionId).toBe('current')
    await expect(management.saveDomain()).resolves.toBe(false)
  })

  it('ignores activation results after disposal', async () => {
    const { management, runtime } = setup()
    const pending = deferred<undefined>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const activating = management.activateRevision(revision)
    const sending = dialog.options.onConfirm()
    scope.stop()
    pending.resolve(undefined)
    await sending
    dialog.resolve(true)
    await expect(activating).resolves.toBe(false)
    expect(runtime.refresh).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it.each(['save', 'activate'] as const)('ignores a late refresh failure after a successful %s and disposal', async (kind) => {
    const { management, runtime, revisions } = setup()
    management.domainState.defaultDomain = 'draft.test'
    fetchMock.mockResolvedValue({ defaultDomain: 'draft.test', activeRevisionId: 'current', updatedAt: '', revision: null })
    const started = deferred<undefined>()
    const reading = deferred<{ status: 'error', error: Error }>()
    revisions.refresh.mockImplementationOnce(() => {
      started.resolve(undefined)
      return reading.promise
    })
    const operation = kind === 'save' ? management.saveDomain() : management.activateRevision(revision)
    const confirmation = kind === 'activate' ? dialog.options.onConfirm() : undefined
    await started.promise
    expect(management.controls.value.disabled).toBe(true)
    scope.stop()
    reading.resolve({ status: 'error', error: new Error('late read failure') })
    await confirmation
    if (kind === 'activate') dialog.resolve(true)
    await expect(operation).resolves.toBe(false)
    expect(runtime.data.value.activeRevisionId).toBe(kind === 'activate' ? 'old' : 'current')
    expect(toast.mock.calls.map(call => call[0].color)).toEqual(['success'])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(runtime.refresh).toHaveBeenCalledOnce()
    expect(revisions.refresh).toHaveBeenCalledOnce()
  })
})
