import { computed, onScopeDispose, reactive, ref, watch } from 'vue'
import type { PlatformRoutingRevisionSummary, PlatformRuntime } from '#shared/types/platform'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'
import { useConfirmedOperation } from '~/composables/use-confirmed-operation'
import { parseFetchError } from '~/utils/client-error'

export function useAdminRuntimeManagement() {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirmedOperation()
  const runtimeResource = usePrivateResource<PlatformRuntime>({
    path: '/api/admin/v1/runtime',
    defaultData: () => ({ defaultDomain: null, activeRevisionId: null, updatedAt: '' })
  })
  const revisionsResource = usePrivatePagedList<Record<string, never>, PlatformRoutingRevisionSummary>({
    path: '/api/admin/v1/revisions', defaultFilters: {}, defaultPageSize: PAGE_SIZE_OPTIONS[0]
  })
  const runtime = computed(() => runtimeResource.data.value)
  const revisions = computed(() => revisionsResource.items.value)
  const loading = computed(() => runtimeResource.loading.value || revisionsResource.loading.value)
  const resourceError = computed(() => runtimeResource.error.value || revisionsResource.error.value)
  const domainState = reactive({ defaultDomain: '' })
  const domainDirty = computed(() => domainState.defaultDomain.trim() !== (runtime.value.defaultDomain ?? ''))
  const active = ref<'domain' | 'activation' | null>(null)
  const disposed = ref(false)
  const controls = computed(() => ({
    savingDomain: active.value === 'domain',
    disabled: disposed.value || active.value !== null || runtimeResource.loading.value || Boolean(runtimeResource.error.value),
    refreshDisabled: disposed.value || active.value !== null
  }))
  watch(() => runtime.value.defaultDomain, (domain, previous) => {
    // Availability/list refreshes must not discard an unsaved domain draft.
    // During a save, even reverting to the old domain is a new user edit.
    if (active.value === 'domain') return
    if (domainState.defaultDomain.trim() === (previous ?? '')) domainState.defaultDomain = domain ?? ''
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(() => { disposed.value = true })

  async function refreshResources() {
    if (disposed.value) return
    try {
      await Promise.all([runtimeResource.refresh(), revisionsResource.refresh()])
    } catch (error: unknown) {
      if (!disposed.value) toast.add({ title: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' })
    }
  }

  async function refresh() {
    if (!controls.value.refreshDisabled) await refreshResources()
  }

  async function saveDomain() {
    if (controls.value.disabled || !domainDirty.value) return false
    const draft = domainState.defaultDomain
    active.value = 'domain'
    try {
      const result = await $fetch<PlatformRuntime & { revision: { id: string } | null }>('/api/admin/v1/runtime', {
        method: 'PATCH', body: { defaultDomain: draft.trim() || null }
      })
      if (disposed.value) return false
      runtimeResource.data.value = result
      if (domainState.defaultDomain === draft) domainState.defaultDomain = result.defaultDomain ?? ''
      toast.add({
        title: t('admin.apis.routing.feedback.defaultDomainUpdated'),
        description: t(result.revision ? 'admin.apis.routing.feedback.runtimeUpdated' : 'admin.apis.routing.feedback.runtimeUnchanged'),
        color: 'success'
      })
      await refreshResources()
      return !disposed.value
    } catch (error: unknown) {
      if (!disposed.value) toast.add({ title: parseFetchError(error, t('admin.apis.routing.feedback.updateFailed')), color: 'error' })
      return false
    } finally {
      active.value = null
    }
  }

  async function activateRevision(revision: PlatformRoutingRevisionSummary) {
    if (controls.value.disabled || revision.id === runtime.value.activeRevisionId) return false
    const { id, sequence } = revision
    active.value = 'activation'
    try {
      return await confirm({
        title: t('admin.apis.routing.rollback.title', { sequence }),
        description: t('admin.apis.routing.rollback.description'),
        confirmLabel: t('admin.apis.routing.actions.activateRevision'),
        confirmColor: 'warning',
        mutate: () => $fetch('/api/admin/v1/revisions/activate', { method: 'POST', body: { revisionId: id } }),
        onError: (error) => { toast.add({ title: parseFetchError(error, t('admin.apis.routing.feedback.activateFailed')), color: 'error' }) },
        onSuccess: async () => {
          runtimeResource.data.value = { ...runtime.value, activeRevisionId: id }
          toast.add({ title: t('admin.apis.routing.feedback.revisionActivated', { sequence }), color: 'success' })
          await refreshResources()
        }
      })
    } finally {
      active.value = null
    }
  }

  return {
    runtime, revisions, revisionsResource, loading, resourceError, domainState, domainDirty, controls,
    revisionPage: revisionsResource.page, revisionPageSize: revisionsResource.pageSize,
    refresh, saveDomain, activateRevision
  }
}
