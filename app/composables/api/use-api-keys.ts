import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { LazyApiKeyResetModal, LazyApiKeySecretModal } from '#components'
import { parseFetchError } from '~/utils/client-error'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import { useConfirmedOperation } from '~/composables/use-confirmed-operation'
import { useApiKeyForm } from '~/composables/api/use-api-key-form'
import type { ApiKeyItem, ApiKeyScopeOption, CreatedApiKeyItem } from '#shared/types/api'

interface UseApiKeysOptions {
  scope: 'user' | 'admin'
  getUserId?: () => number | null | undefined
  open?: () => boolean
  onKeyRevoked?: (id: number) => void
}

/** Own list reads, editor context and admitted writes for one visible Key manager.
 * Closing or changing its owner invalidates reads, results and secret overlays. */
export function useApiKeys(options: UseApiKeysOptions) {
  const admin = options.scope === 'admin'
  const base = admin ? '/api/admin/users/apikeys' : '/api/user/apikeys'
  const toast = useToast()
  const { t, locale } = useI18n()
  const overlay = useOverlay()
  const resetModal = overlay.create(LazyApiKeyResetModal, { destroyOnClose: true })
  const secretModal = overlay.create(LazyApiKeySecretModal, { destroyOnClose: true })
  const context = computed(() => options.open?.() === false ? null : admin ? options.getUserId?.() ?? null : 'user')
  const confirm = useConfirmedOperation(() => context.value)
  const list = usePrivateResource<ApiKeyItem[]>({
    path: admin ? base : `${base}/list`,
    query: () => admin ? { userId: options.getUserId?.() } : undefined,
    defaultData: () => [], immediate: false
  })
  const scopes = usePrivateResource<ApiKeyScopeOption[]>({
    path: admin ? '/api/admin/apis-list' : '/api/user/apis-list',
    defaultData: () => [], immediate: false
  })
  const editor = useApiKeyForm()
  const formOpen = ref(false)
  const editingId = ref<number | null>(null)
  const submitting = ref(false)
  let mounted = false
  let disposed = false
  let generation = 0
  let editorGeneration = 0
  let activeWrite: object | null = null
  let scopeRead: Promise<void> | null = null
  const available = () => mounted && !disposed && context.value !== null
  const isCurrent = (version: number) => available() && generation === version

  function report(error: unknown, key: string) {
    toast.add({ title: parseFetchError(error, t(key)), color: 'error' })
  }

  async function refresh() {
    if (!available() || activeWrite) return
    const version = generation
    const result = await list.refresh()
    if (isCurrent(version) && result.status === 'error') report(result.error, admin ? 'admin.users.apiKeys.loadFailed' : 'user.apiKeys.loadFailed')
  }

  function ensureScopeOptions(): Promise<void> {
    if (!available() || scopes.status.value === 'success') return Promise.resolve()
    if (scopeRead) return scopeRead
    const version = generation
    const pending = (async () => {
      const result = await scopes.refresh()
      if (isCurrent(version) && result.status === 'error') report(result.error, 'common.apiKeys.loadScopesFailed')
    })().finally(() => { if (scopeRead === pending) scopeRead = null })
    scopeRead = pending
    return pending
  }

  const allScopes = computed(() => scopes.data.value.map(o => o.scope))
  const scopeSelectItems = computed(() => scopes.data.value.map(o => ({ label: `${o.name}  ${o.apiPath}`, value: o.scope })))
  const scopeLabelMap = computed(() => new Map(scopes.data.value.map(o => [o.scope, o.name])))

  watch(formOpen, () => { editorGeneration += 1 }, { flush: 'sync' })
  function clearContext() {
    generation += 1
    editorGeneration += 1
    activeWrite = null
    submitting.value = false
    formOpen.value = false
    editingId.value = null
    editor.reset()
    list.invalidate()
    list.data.value = []
    scopes.invalidate()
    scopes.data.value = []
    scopeRead = null
    resetModal.close()
    secretModal.close()
  }
  function loadContext() {
    void refresh()
    if (admin) void ensureScopeOptions()
  }
  watch(context, () => { clearContext(); if (available()) loadContext() }, { flush: 'sync' })
  onMounted(() => { mounted = true; if (available()) loadContext() })
  onScopeDispose(() => { disposed = true; clearContext() })

  async function openForm(key?: ApiKeyItem) {
    if (!available()) return
    editingId.value = key?.id ?? null
    if (key) editor.loadFrom(key)
    else editor.reset()
    formOpen.value = true
    const version = ++editorGeneration
    await ensureScopeOptions()
    if (available() && formOpen.value && editorGeneration === version) editor.preselectAllScopes(allScopes.value)
  }

  type WriteResult<T> = { status: 'success', value: T } | { status: 'error', error: unknown } | { status: 'ignored' }
  async function write<T>(action: string, body: object): Promise<WriteResult<T>> {
    if (!available() || activeWrite) return { status: 'ignored' }
    const operation = { generation }
    activeWrite = operation
    submitting.value = true
    list.invalidate()
    try {
      const value = await $fetch<T>(`${base}/${action}`, { method: 'POST', body }) as T
      return isCurrent(operation.generation) ? { status: 'success', value } : { status: 'ignored' }
    } catch (error) {
      return isCurrent(operation.generation) ? { status: 'error', error } : { status: 'ignored' }
    } finally {
      if (activeWrite === operation) {
        activeWrite = null
        submitting.value = false
        // Reading failure is independent of the acknowledged write. Never replay it.
        void refresh()
      }
    }
  }

  async function submitForm() {
    if (!available() || !formOpen.value || activeWrite) return
    if (editor.error.value) {
      toast.add({ title: editor.error.value, color: 'warning' })
      return
    }
    const version = generation
    const formVersion = editorGeneration
    const id = editingId.value
    const payload = editor.buildPayload()
    const body = id === null
      ? { ...payload, count: editor.form.count, ...(admin ? { userId: options.getUserId?.() } : {}) }
      : { ...payload, id }
    const result = await write<{ keys: CreatedApiKeyItem[], count: number }>(id === null ? 'add' : 'update', body)
    if (!isCurrent(version) || editorGeneration !== formVersion || !formOpen.value) return
    if (result.status === 'error') {
      report(result.error, id === null ? 'common.feedback.createFailed' : 'common.feedback.updateFailed')
    } else if (result.status === 'success') {
      if (id === null) {
        const { keys, count } = result.value
        toast.add({
          title: count > 1
            ? t(admin ? 'admin.users.apiKeys.feedback.createdMany' : 'user.apiKeys.createdMany', { count: count.toLocaleString(locale.value) })
            : t(admin ? 'admin.users.apiKeys.feedback.createdOne' : 'user.apiKeys.createdOne'),
          color: 'success'
        })
        secretModal.open({ keys })
      } else toast.add({ title: t('common.feedback.updated'), color: 'success' })
      formOpen.value = false
      editingId.value = null
      editor.reset()
    }
  }

  async function toggleActive(key: ApiKeyItem) {
    const version = generation
    const isActive = !key.isActive
    const result = await write('update', { id: key.id, isActive })
    if (!isCurrent(version)) return
    if (result.status === 'error') report(result.error, 'common.feedback.operationFailed')
    if (result.status === 'success') {
      toast.add({ title: t(isActive ? 'common.apiKeys.feedback.enabled' : 'common.apiKeys.feedback.disabled'), color: 'success' })
    }
  }

  function openReset(key: ApiKeyItem) {
    if (!available() || activeWrite) return
    const version = generation
    resetModal.open({
      target: key,
      onReset: async (id: number) => {
        if (!isCurrent(version) || id !== key.id) return
        const result = await write<CreatedApiKeyItem>('reset', { id })
        if (!isCurrent(version)) return
        if (result.status === 'error') throw result.error
        if (result.status === 'success') {
          options.onKeyRevoked?.(id)
          return result.value
        }
      }
    })
  }

  async function remove(key: ApiKeyItem) {
    if (!available() || activeWrite) return
    const version = generation
    const mutate = async () => {
      if (!isCurrent(version)) return
      const result = await write('delete', { id: key.id })
      if (!isCurrent(version)) return
      if (result.status === 'error') throw result.error
      if (result.status === 'success') {
        options.onKeyRevoked?.(key.id)
        toast.add({ title: t('common.feedback.deleted'), color: 'success' })
      }
    }
    if (admin) {
      try { await mutate() } catch (error) { if (isCurrent(version)) report(error, 'common.feedback.deleteFailed') }
    } else {
      await confirm({
        title: t('common.apiKeys.delete.title', { name: key.name || t('common.apiKeys.defaultName') }),
        description: t('common.apiKeys.delete.description'),
        mutate,
        onSuccess: () => {},
        onError: error => report(error, 'common.feedback.deleteFailed')
      })
    }
  }

  return {
    items: list.data, loading: list.loading, refresh,
    scopeSelectItems, scopeLabelMap,
    form: editor.form, formError: editor.error, ipLineErrors: editor.ipLineErrors,
    formOpen, editingId, submitting, isCreating: computed(() => editingId.value === null),
    openCreate: () => openForm(), openEdit: (key: ApiKeyItem) => openForm(key),
    submitForm, toggleActive, openReset, remove
  }
}
