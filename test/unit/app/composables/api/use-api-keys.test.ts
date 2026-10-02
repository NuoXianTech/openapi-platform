import { effectScope, reactive, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApiKeys } from '~/composables/api/use-api-keys'
import AdminUserKeysModal from '~/components/admin/AdminUserKeysModal.vue'
import ApiKeyResetModal from '~/components/api-key/ApiKeyResetModal.vue'
import type { ApiKeyItem, CreatedApiKeyItem } from '#shared/types/api'
import type { ConfirmDialogOptions } from '~/composables/use-confirm-dialog'

const hooks = vi.hoisted(() => ({ mounted: [] as (() => void)[] }))
vi.mock('vue', async original => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => hooks.mounted.push(callback)
}))

const fetchMock = vi.fn()
const toast = vi.fn()
const resetOverlay = { open: vi.fn(), close: vi.fn() }
const secretOverlay = { open: vi.fn(), close: vi.fn() }
const revoked = vi.fn()
const confirmDialog = vi.fn()
let scope = effectScope()
const key = {
  id: 7, name: 'Original', isActive: true, keyPreview: 'sk_…', totalQuota: null,
  scopes: null, ipWhitelist: null, expiresAt: null
} as ApiKeyItem
const created = { ...key, apiKey: 'fixture-secret' } as CreatedApiKeyItem
const scopeOptions = [{ scope: 'read', name: 'Read', apiPath: '/read' }]
const posts = () => fetchMock.mock.calls.filter(([, options]) => options.method === 'POST')
const settle = () => new Promise<void>(resolve => setImmediate(resolve))
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
function setupScript<T>(component: unknown, props: object, emit = vi.fn()): T {
  return (component as { setup: (props: object, context: object) => T }).setup(props, { expose: () => {}, emit })
}
function setup(kind: 'user' | 'admin' = 'admin', initiallyOpen = true) {
  const open = ref(initiallyOpen)
  const id = ref<number | null>(1)
  const manager = scope.run(() => useApiKeys({ scope: kind, open: () => open.value, getUserId: () => id.value, onKeyRevoked: revoked }))!
  const mount = () => hooks.mounted.splice(0).forEach(callback => callback())
  return { manager, open, id, mount }
}

beforeEach(() => {
  scope = effectScope()
  hooks.mounted = []
  vi.resetAllMocks()
  fetchMock.mockImplementation(async (path: string) => path.endsWith('/apis-list') ? scopeOptions : [key])
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale: ref('zh-CN') }))
  vi.stubGlobal('useCopyFeedback', () => ({ copyText: vi.fn() }))
  vi.stubGlobal('useConfirmDialog', () => confirmDialog)
  vi.stubGlobal('useOverlay', () => ({ create: (component: { name: string }) => component.name === 'reset' ? resetOverlay : secretOverlay }))
})
afterEach(() => { scope.stop(); vi.unstubAllGlobals() })

describe('Key manager reads and lifetime', () => {
  it('loads an administrator modal mounted already open, matching the parent v-if', async () => {
    const props = reactive({ open: true, target: { id: 1 } })
    const vm = scope.run(() => setupScript<{ keys: Ref<ApiKeyItem[]>, scopeSelectItems: Ref<unknown[]> }>(AdminUserKeysModal, props))!
    expect(fetchMock).not.toHaveBeenCalled()
    hooks.mounted.splice(0).forEach(callback => callback())
    await settle()
    expect(vm.keys.value).toEqual([key])
    expect(vm.scopeSelectItems.value).toEqual([{ label: 'Read  /read', value: 'read' }])
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/apikeys', expect.objectContaining({ query: { userId: 1 } }))
  })

  it('does not fetch until a valid owner is visible, and cancels stale owner reads', async () => {
    const { manager, mount, open, id } = setup('admin', false)
    mount()
    expect(fetchMock).not.toHaveBeenCalled()
    const old = deferred<ApiKeyItem[]>()
    fetchMock.mockReturnValueOnce(old.promise)
    open.value = true
    const signal = fetchMock.mock.calls[0]![1].signal as AbortSignal
    id.value = 2
    await settle()
    old.resolve([{ ...key, id: 1 }])
    await settle()
    expect(signal.aborted).toBe(true)
    expect(manager.items.value).toEqual([key])
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/users/apikeys', expect.objectContaining({ query: { userId: 2 } }))
    id.value = null
    await manager.refresh()
    expect(manager.items.value).toEqual([])
  })

  it('merges scope reads and does not overwrite a newer editor selection when scopes arrive', async () => {
    const pending = deferred<typeof scopeOptions>()
    fetchMock.mockImplementation(async (path: string) => path.endsWith('/apis-list') ? pending.promise : [key])
    const { manager, mount } = setup()
    mount()
    const first = manager.openCreate()
    const second = manager.openEdit({ ...key, scopes: ['chosen'] })
    pending.resolve(scopeOptions)
    await Promise.all([first, second])
    expect(fetchMock.mock.calls.filter(([path]) => path.endsWith('/apis-list'))).toHaveLength(1)
    expect(manager.form.scopesSelected).toEqual(['chosen'])
  })

  it.each(['close', 'switch', 'dispose'] as const)('ignores a creation response after %s, without a late refresh or secret overlay', async (change) => {
    const { manager, open, id, mount } = setup()
    mount()
    await manager.openCreate()
    const pending = deferred<{ keys: CreatedApiKeyItem[], count: number }>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const write = manager.submitForm()
    if (change === 'close') open.value = false
    if (change === 'switch') id.value = 2
    if (change === 'dispose') scope.stop()
    await settle()
    const calls = fetchMock.mock.calls.length
    pending.resolve({ keys: [created], count: 1 })
    await write
    expect(secretOverlay.open).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(calls)
    if (change !== 'switch') {
      await manager.refresh()
      await manager.openCreate()
      await manager.submitForm()
      expect(fetchMock).toHaveBeenCalledTimes(calls)
    }
  })

  it('closes owned overlays when its context disappears', () => {
    const { manager, open, mount } = setup()
    mount()
    manager.openReset(key)
    open.value = false
    expect(resetOverlay.close).toHaveBeenCalledOnce()
    expect(secretOverlay.close).toHaveBeenCalledOnce()
  })
})

describe('Key manager mutations', () => {
  it.each(['user', 'admin'] as const)('creates once for %s with a captured payload and preserves success when refresh fails', async (kind) => {
    const { manager, mount } = setup(kind)
    mount()
    await manager.openCreate()
    manager.form.scopesMode = 'pick'
    manager.form.scopesSelected = ['read']
    const pending = deferred<{ keys: CreatedApiKeyItem[], count: number }>()
    fetchMock.mockReturnValueOnce(pending.promise).mockRejectedValueOnce({})
    const write = manager.submitForm()
    manager.form.scopesSelected.push('later')
    await manager.submitForm()
    expect(posts()).toHaveLength(1)
    expect(posts()[0]![0]).toBe(kind === 'admin' ? '/api/admin/users/apikeys/add' : '/api/user/apikeys/add')
    expect(posts()[0]![1].body.scopes).toEqual(['read'])
    if (kind === 'admin') expect(posts()[0]![1].body.userId).toBe(1)
    else expect(posts()[0]![1].body).not.toHaveProperty('userId')
    pending.resolve({ keys: [created], count: 1 })
    await write
    await settle()
    expect(secretOverlay.open).toHaveBeenCalledExactlyOnceWith({ keys: [created] })
    expect(manager.formOpen.value).toBe(false)
    expect(toast).toHaveBeenCalledWith({ title: kind === 'admin' ? 'admin.users.apiKeys.loadFailed' : 'user.apiKeys.loadFailed', color: 'error' })
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ color: 'success' }))
    await manager.submitForm()
    expect(posts()).toHaveLength(1)
  })

  it.each(['resolve', 'reject'] as const)('does not alter a reopened editor after the old save %s', async (outcome) => {
    const { manager, mount } = setup()
    mount()
    await manager.openEdit(key)
    const pending = deferred<unknown>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const write = manager.submitForm()
    manager.formOpen.value = false
    await manager.openEdit({ ...key, id: 8, name: 'New draft' })
    if (outcome === 'resolve') pending.resolve({})
    else pending.reject(new Error('stale failure'))
    await write
    expect(manager.formOpen.value).toBe(true)
    expect(manager.editingId.value).toBe(8)
    expect(manager.form.name).toBe('New draft')
    expect(toast).not.toHaveBeenCalled()
  })

  it('keeps a failed save retryable and closes the editor after a successful update', async () => {
    const { manager, mount } = setup()
    mount()
    await manager.openEdit(key)
    fetchMock.mockRejectedValueOnce({})
    await manager.submitForm()
    expect(manager.formOpen.value).toBe(true)
    expect(toast).toHaveBeenCalledWith({ title: 'common.feedback.updateFailed', color: 'error' })
    await manager.submitForm()
    expect(posts()).toHaveLength(2)
    expect(posts()[1]![1].body.id).toBe(key.id)
    expect(manager.formOpen.value).toBe(false)
  })

  it('does not let an old owner operation release the new owner submission', async () => {
    const { manager, id, mount } = setup()
    mount()
    await manager.openCreate()
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    fetchMock.mockReturnValueOnce(first.promise)
    const a = manager.submitForm()
    id.value = 2
    await manager.openCreate()
    fetchMock.mockReturnValueOnce(second.promise)
    const b = manager.submitForm()
    first.resolve({ keys: [created], count: 1 })
    await a
    expect(manager.submitting.value).toBe(true)
    await manager.submitForm()
    expect(posts()).toHaveLength(2)
    second.resolve({ keys: [created], count: 1 })
    await b
    expect(manager.submitting.value).toBe(false)
    expect(secretOverlay.open).toHaveBeenCalledOnce()
  })

  it('prevents duplicate toggles and keeps the action based on the submitted state', async () => {
    const { manager, mount } = setup()
    mount()
    await settle()
    const row = { ...key }
    const pending = deferred<unknown>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const write = manager.toggleActive(row)
    row.isActive = false
    await manager.toggleActive(row)
    pending.resolve({})
    await write
    expect(posts()).toHaveLength(1)
    expect(posts()[0]![1].body).toEqual({ id: key.id, isActive: false })
    expect(toast).toHaveBeenCalledWith({ title: 'common.apiKeys.feedback.disabled', color: 'success' })
  })

  it('invalidates revealed values after reset succeeds, even if refreshing fails', async () => {
    const { manager, mount } = setup('user')
    mount()
    await settle()
    manager.openReset(key)
    const onReset = resetOverlay.open.mock.calls[0]![0].onReset as (id: number) => Promise<CreatedApiKeyItem | undefined>
    fetchMock.mockResolvedValueOnce(created).mockRejectedValueOnce({})
    await expect(onReset(key.id)).resolves.toEqual(created)
    expect(revoked).toHaveBeenCalledExactlyOnceWith(key.id)
  })

  it('makes a retained reset callback inert after changing owners', async () => {
    const { manager, mount, id } = setup()
    mount()
    manager.openReset(key)
    const onReset = resetOverlay.open.mock.calls[0]![0].onReset
    id.value = 2
    await expect(onReset(key.id)).resolves.toBeUndefined()
    expect(posts()).toHaveLength(0)
  })

  it('does not replay a confirmed deletion when refreshing fails, and clears the revealed value', async () => {
    const { manager, mount } = setup('user')
    mount()
    await settle()
    confirmDialog.mockImplementationOnce(async (dialog: ConfirmDialogOptions) => {
      await dialog.onConfirm?.()
      await dialog.onConfirm?.()
      return true
    })
    fetchMock.mockResolvedValueOnce({}).mockRejectedValueOnce({})
    await manager.remove(key)
    expect(posts()).toHaveLength(1)
    expect(revoked).toHaveBeenCalledExactlyOnceWith(key.id)
    expect(toast).toHaveBeenCalledWith({ title: 'common.feedback.deleted', color: 'success' })
  })

  it('ignores a pending deletion confirmation after the view closes', async () => {
    const { manager, mount, open } = setup('user')
    mount()
    confirmDialog.mockImplementationOnce(async (dialog: ConfirmDialogOptions) => {
      open.value = false
      await dialog.onConfirm?.()
      return true
    })
    await manager.remove(key)
    expect(posts()).toHaveLength(0)
  })
})

describe('reset modal result lifetime', () => {
  function resetSetup() {
    const props = reactive({ open: true, target: key as ApiKeyItem | null, onReset: vi.fn() })
    const emit = vi.fn()
    const vm = scope.run(() => setupScript<{
      confirmReset: () => Promise<void>, updateOpen: (open: boolean) => void,
      result: Ref<CreatedApiKeyItem | null>, loading: Ref<boolean>
    }>(ApiKeyResetModal, props, emit))!
    return { props, emit, vm }
  }

  it('admits one reset and retains its result without allowing an accidental second reset', async () => {
    const { props, emit, vm } = resetSetup()
    const pending = deferred<CreatedApiKeyItem>()
    props.onReset.mockReturnValueOnce(pending.promise)
    const write = vm.confirmReset()
    await vm.confirmReset()
    pending.resolve(created)
    await write
    await vm.confirmReset()
    expect(props.onReset).toHaveBeenCalledOnce()
    expect(vm.result.value).toEqual(created)
    expect(emit).toHaveBeenCalledExactlyOnceWith('saved')
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'common.apiKeys.reset.success', color: 'success' })
  })

  it.each(['close', 'target', 'dispose', 'close-event'] as const)('ignores a reset result after %s', async (change) => {
    const { props, emit, vm } = resetSetup()
    const pending = deferred<CreatedApiKeyItem>()
    props.onReset.mockReturnValueOnce(pending.promise)
    const write = vm.confirmReset()
    if (change === 'close') props.open = false
    if (change === 'target') props.target = { ...key, id: 8 }
    if (change === 'dispose') scope.stop()
    if (change === 'close-event') vm.updateOpen(false)
    pending.resolve(created)
    await write
    expect(vm.result.value).toBeNull()
    expect(emit).not.toHaveBeenCalledWith('saved')
    expect(toast).not.toHaveBeenCalled()
  })

  it('treats an ignored reset as no result, not a successful reset', async () => {
    const { props, emit, vm } = resetSetup()
    props.onReset.mockResolvedValueOnce(undefined)
    await vm.confirmReset()
    expect(vm.result.value).toBeNull()
    expect(vm.loading.value).toBe(false)
    expect(emit).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('keeps the new reset loading state when an old reset fails after switching targets', async () => {
    const { props, vm } = resetSetup()
    const first = deferred<CreatedApiKeyItem>()
    const second = deferred<CreatedApiKeyItem>()
    props.onReset.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const a = vm.confirmReset()
    props.target = { ...key, id: 8 }
    const b = vm.confirmReset()
    first.reject(new Error('old failure'))
    await a
    expect(vm.loading.value).toBe(true)
    expect(toast).not.toHaveBeenCalled()
    second.resolve({ ...created, id: 8 })
    await b
    expect(vm.result.value?.id).toBe(8)
  })
})
