import { computed, onScopeDispose, ref, watch } from 'vue'
import type { PlatformApiVersion, PlatformProduct, PlatformProductSummary } from '#shared/types/platform'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'
import { parseFetchError } from '~/utils/client-error'

export type ProductFormValues = Pick<PlatformProductSummary, 'name' | 'summary' | 'description' | 'visibility' | 'lifecycle'>
export type VersionFormValues = Pick<PlatformApiVersion, 'state' | 'changelog'>

export function useAdminProductManagement() {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirmDialog()
  const resource = usePrivatePagedList<Record<string, never>, PlatformProduct>({
    path: '/api/admin/v1/products/paged', defaultFilters: {}, defaultPageSize: PAGE_SIZE_OPTIONS[0]
  })
  const products = computed(() => resource.items.value)
  const modalOpen = ref(false)
  const versionModalOpen = ref(false)
  const editingProduct = ref<PlatformProduct | null>(null)
  const versionProduct = ref<PlatformProduct | null>(null)
  const editingVersion = ref<PlatformApiVersion | null>(null)
  const active = ref<'product' | 'version' | 'delete' | null>(null)
  const disposed = ref(false)
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
  onScopeDispose(() => { disposed.value = true })

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
    if (disposed.value) return
    try {
      await resource.refresh()
      if (!disposed.value) reconcileEditors()
    } catch (error: unknown) {
      if (!disposed.value) toast.add({ title: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' })
    }
  }
  async function refresh() {
    if (!controls.value.refreshDisabled) await refreshProducts()
  }

  async function save(kind: 'product' | 'version', body: ProductFormValues | VersionFormValues) {
    if (controls.value.disabled) return false
    const id = kind === 'product' ? editingProduct.value?.id : editingVersion.value?.id
    if (!id) return false
    active.value = kind
    try {
      await $fetch(`/api/admin/v1/${kind === 'product' ? 'products' : 'versions'}/${id}`, { method: 'PATCH', body })
      if (disposed.value) return false
      toast.add({ title: t(kind === 'product' ? 'admin.apis.routing.feedback.productUpdated' : 'admin.apis.routing.feedback.versionUpdated'), color: 'success' })
      if (kind === 'product') modalOpen.value = false
      else versionModalOpen.value = false
      await refreshProducts()
      return !disposed.value
    } catch (error: unknown) {
      if (!disposed.value) toast.add({ title: parseFetchError(error, t('admin.apis.routing.feedback.updateFailed')), color: 'error' })
      return false
    } finally {
      active.value = null
    }
  }

  async function remove(product: PlatformProduct, version?: PlatformApiVersion) {
    if (controls.value.disabled) return false
    const id = version?.id ?? product.id
    active.value = 'delete'
    let valid = true
    let completed = false
    let running: Promise<void> | null = null
    try {
      const answer = await confirm({
        title: t(version ? 'admin.apis.routing.deleteVersion.title' : 'admin.apis.routing.deleteProduct.title', version ? { version: version.version } : { name: product.name }),
        description: t(version ? 'admin.apis.routing.deleteVersion.description' : 'admin.apis.routing.deleteProduct.description'),
        confirmColor: 'error',
        onConfirm: () => {
          if (!valid || disposed.value || completed) return
          running ??= (async () => {
            try {
              await $fetch(`/api/admin/v1/${version ? 'versions' : 'products'}/${id}`, { method: 'DELETE' })
            } catch (error: unknown) {
              if (!disposed.value) toast.add({ title: parseFetchError(error, t('common.feedback.deleteFailed')), color: 'error' })
              throw error
            }
            completed = true
            if (disposed.value) return
            toast.add({ title: t('common.feedback.deleted'), color: 'success' })
            if (!version && editingProduct.value?.id === id) modalOpen.value = false
            if (version ? editingVersion.value?.id === id : versionProduct.value?.id === id) versionModalOpen.value = false
            await refreshProducts()
          })().finally(() => { running = null })
          return running
        }
      })
      return answer && completed && !disposed.value
    } finally {
      valid = false
      active.value = null
    }
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
