import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlatformApiVersion, PlatformProduct } from '#shared/types/platform'
import { useAdminProductManagement, type ProductFormValues } from '~/composables/admin/use-admin-product-management'

const { paged } = vi.hoisted(() => ({ paged: vi.fn() }))
vi.mock('~/composables/dashboard/use-private-paged-list', () => ({ usePrivatePagedList: paged }))
const fetchMock = vi.fn()
const toast = vi.fn()
const confirm = vi.fn()
let scope = effectScope()
let dialog: { options: { onConfirm: () => Promise<void> | void }, resolve: (value: boolean) => void }
const version = { id: 'version', version: 'v1', state: 'published', changelog: '' } as PlatformApiVersion
const product = { id: 'product', name: 'Product', versions: [version] } as PlatformProduct
const values: ProductFormValues = { name: ' Name ', summary: ' Summary ', description: ' Description ', visibility: 'private', lifecycle: 'deprecated' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
function setup() {
  const resource = { items: ref([product]), page: ref(1), pageSize: ref(20), total: ref(1), loading: ref(false), error: ref<unknown>(null), refresh: vi.fn().mockResolvedValue(undefined) }
  paged.mockReturnValue(resource)
  const management = scope.run(useAdminProductManagement)!
  return { management, resource }
}
beforeEach(() => {
  scope = effectScope()
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useConfirmDialog', () => confirm)
  vi.stubGlobal('$fetch', fetchMock)
  fetchMock.mockResolvedValue({})
  confirm.mockImplementation(options => new Promise<boolean>((resolve) => { dialog = { options, resolve } }))
})
afterEach(() => { scope.stop(); vi.resetAllMocks(); vi.unstubAllGlobals() })

describe('Product and Version management', () => {
  it('normalizes Product edits, closes on success, and refreshes once', async () => {
    const { management, resource } = setup()
    management.openEditProduct(product)
    await expect(management.saveProduct(values)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/products/product', {
      method: 'PATCH', body: { ...values, name: 'Name', summary: 'Summary', description: 'Description' }
    })
    expect(values.name).toBe(' Name ')
    expect(management.modalOpen.value).toBe(false)
    expect(management.editingProduct.value).toBeNull()
    expect(resource.refresh).toHaveBeenCalledOnce()
  })

  it('saves Version lifecycle and changelog without changing its identifier', async () => {
    const { management } = setup()
    management.openVersion(product, version)
    await expect(management.saveVersion({ state: 'retired', changelog: ' Retired ' })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/versions/version', { method: 'PATCH', body: { state: 'retired', changelog: 'Retired' } })
    expect(management.versionModalOpen.value).toBe(false)
    expect(management.editingVersion.value).toBeNull()
  })

  it.each(['product', 'version'] as const)('keeps the %s editor after failure and permits retry', async (kind) => {
    const { management } = setup()
    if (kind === 'product') management.openEditProduct(product)
    else management.openVersion(product, version)
    const save = () => kind === 'product' ? management.saveProduct(values) : management.saveVersion({ state: 'published', changelog: 'draft' })
    fetchMock.mockRejectedValueOnce(new Error('failed'))
    await expect(save()).resolves.toBe(false)
    expect(kind === 'product' ? management.modalOpen.value : management.versionModalOpen.value).toBe(true)
    expect(management.controls.value.disabled).toBe(false)
    await expect(save()).resolves.toBe(true)
  })

  it('holds admission through post-save refresh and refuses other editors and deletes', async () => {
    const { management, resource } = setup()
    management.openEditProduct(product)
    const reading = deferred<undefined>()
    resource.refresh.mockReturnValueOnce(reading.promise)
    const saving = management.saveProduct(values)
    await vi.waitFor(() => expect(resource.refresh).toHaveBeenCalledOnce())
    expect(management.controls.value.savingProduct).toBe(true)
    await expect(management.saveProduct(values)).resolves.toBe(false)
    await expect(management.removeProduct(product)).resolves.toBe(false)
    management.openVersion(product, version)
    expect(management.versionModalOpen.value).toBe(false)
    await management.refresh()
    expect(resource.refresh).toHaveBeenCalledOnce()
    reading.resolve(undefined)
    await saving
    expect(management.controls.value.disabled).toBe(false)
  })

  it('retains successful save status when refresh returns an error', async () => {
    const { management, resource } = setup()
    management.openEditProduct(product)
    resource.refresh.mockResolvedValueOnce({ status: 'error', error: new Error('read failed') })
    await expect(management.saveProduct(values)).resolves.toBe(true)
    expect(management.modalOpen.value).toBe(false)
    expect(toast.mock.calls.map(call => call[0].color)).toEqual(['success', 'error'])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reconciles both Product and Version references after a read', async () => {
    const { management, resource } = setup()
    management.openVersion(product, version)
    const replacement = { ...product, name: 'Updated', versions: [{ ...version, changelog: 'new' }] }
    resource.items.value = [replacement]
    await nextTick()
    expect(management.versionProduct.value?.name).toBe('Updated')
    expect(management.editingVersion.value?.changelog).toBe('new')
    expect(management.versionModalOpen.value).toBe(true)
    management.openEditProduct(replacement)
    resource.items.value = [{ ...replacement, name: 'Again' }]
    await nextTick()
    expect(management.editingProduct.value?.name).toBe('Again')
  })

  it('closes an editor removed by a successful paged read but keeps it on read failure', async () => {
    const { management, resource } = setup()
    management.openVersion(product, version)
    resource.error.value = new Error('read failed')
    resource.items.value = []
    await nextTick()
    expect(management.versionModalOpen.value).toBe(true)
    expect(management.editingVersion.value?.id).toBe('version')
    resource.error.value = null
    resource.items.value = []
    await nextTick()
    expect(management.versionModalOpen.value).toBe(false)
  })

  it.each(['product', 'version'] as const)('deletes %s, closes the affected editor and refreshes pagination', async (kind) => {
    const { management, resource } = setup()
    management.openVersion(product, version)
    const deleting = kind === 'product' ? management.removeProduct(product) : management.removeVersion(product, version)
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(deleting).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/admin/v1/${kind === 'product' ? 'products/product' : 'versions/version'}`, { method: 'DELETE' })
    expect(management.versionModalOpen.value).toBe(false)
    expect(resource.refresh).toHaveBeenCalledOnce()
  })

  it('holds confirmation admission and ignores its callback after cancellation', async () => {
    const { management } = setup()
    const deleting = management.removeProduct(product)
    management.openEditProduct(product)
    expect(management.modalOpen.value).toBe(false)
    await expect(management.removeVersion(product, version)).resolves.toBe(false)
    const old = dialog.options
    dialog.resolve(false)
    await expect(deleting).resolves.toBe(false)
    await old.onConfirm()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(management.controls.value.disabled).toBe(false)
  })

  it('retries deletion without closing confirmation and shares repeated confirmation calls', async () => {
    const { management } = setup()
    const deleting = management.removeProduct(product)
    fetchMock.mockRejectedValueOnce(new Error('referenced'))
    await expect(dialog.options.onConfirm()).rejects.toThrow('referenced')
    expect(management.controls.value.disabled).toBe(true)
    const pending = deferred<undefined>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const one = dialog.options.onConfirm()
    expect(dialog.options.onConfirm()).toBe(one)
    pending.resolve(undefined)
    await one
    await dialog.options.onConfirm()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    dialog.resolve(true)
    await expect(deleting).resolves.toBe(true)
  })

  it('does not replay a successful deletion when refresh fails', async () => {
    const { management, resource } = setup()
    resource.refresh.mockResolvedValueOnce({ status: 'error', error: new Error('read failed') })
    const deleting = management.removeProduct(product)
    await dialog.options.onConfirm()
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(deleting).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('ignores late save responses after disposal and rejects new work', async () => {
    const { management, resource } = setup()
    management.openEditProduct(product)
    const pending = deferred<undefined>()
    fetchMock.mockReturnValueOnce(pending.promise)
    const saving = management.saveProduct(values)
    scope.stop()
    pending.resolve(undefined)
    await expect(saving).resolves.toBe(false)
    expect(toast).not.toHaveBeenCalled()
    expect(resource.refresh).not.toHaveBeenCalled()
    await expect(management.removeProduct(product)).resolves.toBe(false)
  })

  it.each(['save', 'delete'] as const)('ignores a late refresh failure after a successful %s and disposal', async (kind) => {
    const { management, resource } = setup()
    management.openEditProduct(product)
    const started = deferred<undefined>()
    const reading = deferred<{ status: 'error', error: Error }>()
    resource.refresh.mockImplementationOnce(() => {
      started.resolve(undefined)
      return reading.promise
    })
    const operation = kind === 'save' ? management.saveProduct(values) : management.removeProduct(product)
    const confirmation = kind === 'delete' ? dialog.options.onConfirm() : undefined
    await started.promise
    expect(management.controls.value.disabled).toBe(true)
    expect(management.modalOpen.value).toBe(false)
    scope.stop()
    reading.resolve({ status: 'error', error: new Error('late read failure') })
    await confirmation
    if (kind === 'delete') dialog.resolve(true)
    await expect(operation).resolves.toBe(false)
    expect(toast.mock.calls.map(call => call[0].color)).toEqual(['success'])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(resource.refresh).toHaveBeenCalledOnce()
  })

  it('blocks reads and confirmation callbacks after disposal', async () => {
    const { management, resource } = setup()
    const deleting = management.removeProduct(product)
    scope.stop()
    await dialog.options.onConfirm()
    dialog.resolve(true)
    await expect(deleting).resolves.toBe(false)
    await management.refresh()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(resource.refresh).not.toHaveBeenCalled()
  })
})
