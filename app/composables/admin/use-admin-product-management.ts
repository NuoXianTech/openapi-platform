import { computed, ref, watch } from 'vue'
import type { PlatformApiVersion, PlatformProduct, PlatformProductSummary } from '#shared/types/platform'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'
import { useConfirmedOperation } from '~/composables/use-confirmed-operation'
import { useOperationLifecycle } from '~/composables/use-operation-lifecycle'
import { parseFetchError } from '~/utils/client-error'

export type ProductFormValues = Pick<PlatformProductSummary, 'name' | 'summary' | 'description' | 'visibility' | 'lifecycle'>
export type VersionFormValues = Pick<PlatformApiVersion, 'state' | 'changelog'>

export function useAdminProductManagement() {
  const { t } = useI18n()
  const toast = useToast()
  const lifecycle = useOperationLifecycle()
  const confirm = useConfirmedOperation(undefined, lifecycle)
  const { active, disposed } = lifecycle
  const resource = usePrivatePagedList<Record<string, never>, PlatformProduct>({
    path: '/api/admin/v1/products/paged', defaultFilters: {}, defaultPageSize: PAGE_SIZE_OPTIONS[0]
  })
  const products = computed(() => resource.items.value)
  const modalOpen = ref(false)
  const versionModalOpen = ref(false)
  const editingProduct = ref<PlatformProduct | null>(null)
  const versionProduct = ref<PlatformProduct | null>(null)
  const editingVersion = ref<PlatformApiVersion | null>(null)
  const controls = computed(() => ({
    disabled: disposed.value || active.value !== null || resource.loading.value || Boolean(resource.error.value),
    refreshDisabled: disposed.value || active.value !== null,
    savingProduct: active.value === 'product',
    savingVersion: active.value === 'version'
  }))
  watch(modalOpen, (open) => { if (!open) editingProduct.value = null }, { flush: 'sync' })
  watch(versionModalOpen, (open) => {
    if (!open) {
      versionProduct.value = null
      editingVersion.value = null
    }
  }, { flush: 'sync' })

  function openEditProduct(product: PlatformProduct) {
    if (controls.value.disabled) return
    versionModalOpen.value = false
    editingProduct.value = product
    modalOpen.value = true
  }

  function openVersion(product: PlatformProduct, version: PlatformApiVersion) {
    if (controls.value.disabled) return
    modalOpen.value = false
    versionProduct.value = product
    editingVersion.value = version
    versionModalOpen.value = true
  }

  // Only a successful read may invalidate an editor. A failed read keeps its draft.
  function reconcileEditors() {
    if (resource.error.value) return
    if (editingProduct.value) {
      editingProduct.value = products.value.find(item => item.id === editingProduct.value?.id) ?? null
      if (!editingProduct.value) modalOpen.value = false
    }
    if (versionProduct.value) {
      versionProduct.value = products.value.find(item => item.id === versionProduct.value?.id) ?? null
      editingVersion.value = versionProduct.value?.versions.find(item => item.id === editingVersion.value?.id) ?? null
      if (!editingVersion.value) versionModalOpen.value = false
    }
  }
  watch(products, reconcileEditors)

  async function refreshProducts() {
    const effects = lifecycle.capture()
    await effects.execute({
      request: async () => {
        const result = await resource.refresh()
        if (result?.status === 'error') throw result.error
        return result
      },
      accept: (result) => { if (result?.status === 'success') reconcileEditors() },
      reject: (error) => { toast.add({ title: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' }) }
    }).catch(() => false)
  }
  async function refresh() {
    if (!controls.value.refreshDisabled) await refreshProducts()
  }

  async function save(kind: 'product' | 'version', body: ProductFormValues | VersionFormValues) {
    if (controls.value.disabled) return false
    const id = kind === 'product' ? editingProduct.value?.id : editingVersion.value?.id
    if (!id) return false
    return lifecycle.run(kind, operation => operation.execute({
      request: () => $fetch(`/api/admin/v1/${kind === 'product' ? 'products' : 'versions'}/${id}`, { method: 'PATCH', body }),
      accept: async () => {
        toast.add({ title: t(kind === 'product' ? 'admin.apis.routing.feedback.productUpdated' : 'admin.apis.routing.feedback.versionUpdated'), color: 'success' })
        if (kind === 'product') modalOpen.value = false
        else versionModalOpen.value = false
        await refreshProducts()
      },
      reject: (error) => { toast.add({ title: parseFetchError(error, t('admin.apis.routing.feedback.updateFailed')), color: 'error' }) }
    })).catch(() => false)
  }

  async function remove(product: PlatformProduct, version?: PlatformApiVersion) {
    if (controls.value.disabled) return false
    const id = version?.id ?? product.id
    return confirm({
      title: t(version ? 'admin.apis.routing.deleteVersion.title' : 'admin.apis.routing.deleteProduct.title', version ? { version: version.version } : { name: product.name }),
      description: t(version ? 'admin.apis.routing.deleteVersion.description' : 'admin.apis.routing.deleteProduct.description'),
      confirmColor: 'error',
      mutate: () => $fetch(`/api/admin/v1/${version ? 'versions' : 'products'}/${id}`, { method: 'DELETE' }),
      onError: (error) => { toast.add({ title: parseFetchError(error, t('common.feedback.deleteFailed')), color: 'error' }) },
      onSuccess: async () => {
        toast.add({ title: t('common.feedback.deleted'), color: 'success' })
        if (!version && editingProduct.value?.id === id) modalOpen.value = false
        if (version ? editingVersion.value?.id === id : versionProduct.value?.id === id) versionModalOpen.value = false
        await refreshProducts()
      }
    })
  }

  return {
    resource, products, controls, modalOpen, versionModalOpen, editingProduct, versionProduct, editingVersion,
    page: resource.page, pageSize: resource.pageSize, total: resource.total,
    openEditProduct, openVersion, refresh,
    saveProduct: (values: ProductFormValues) => save('product', {
      name: values.name.trim(), summary: values.summary.trim(), description: values.description.trim(),
      visibility: values.visibility, lifecycle: values.lifecycle
    }),
    saveVersion: (values: VersionFormValues) => save('version', { state: values.state, changelog: values.changelog.trim() }),
    removeProduct: (product: PlatformProduct) => remove(product),
    removeVersion: (product: PlatformProduct, version: PlatformApiVersion) => remove(product, version)
  }
}
