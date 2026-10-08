import { computed, ref, watch } from 'vue'
import type { PlatformUpstream, PlatformUpstreamTarget } from '#shared/types/platform'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'
import { useAdminTargetOperations, type TargetFormValues } from '~/composables/admin/use-admin-target-operations'
import { useConfirmedOperation } from '~/composables/use-confirmed-operation'
import { useOperationLifecycle } from '~/composables/use-operation-lifecycle'
import { parseFetchError } from '~/utils/client-error'

export function useAdminUpstreamManagement() {
  const { t } = useI18n()
  const toast = useToast()
  const lifecycle = useOperationLifecycle()
  const confirm = useConfirmedOperation(undefined, lifecycle)
  const { active, disposed } = lifecycle
  const resource = usePrivatePagedList<Record<string, never>, PlatformUpstream>({
    path: '/api/admin/v1/upstreams/paged', defaultFilters: {}, defaultPageSize: PAGE_SIZE_OPTIONS[0]
  })
  const upstreams = computed(() => resource.items.value)
  const modalOpen = ref(false)
  const editingUpstream = ref<PlatformUpstream | null>(null)
  const targetModalOpen = ref(false)
  const targetUpstream = ref<PlatformUpstream | null>(null)
  const editingTarget = ref<PlatformUpstreamTarget | null>(null)
  const targetOperations = useAdminTargetOperations({
    refresh: resource.refresh,
    isBlocked: () => disposed.value || active.value !== null || resource.loading.value || Boolean(resource.error.value) || modalOpen.value
  })
  const targetState = targetOperations.state
  const controls = computed(() => {
    const occupied = disposed.value || active.value !== null || targetState.value.busy || modalOpen.value || targetModalOpen.value
    return {
      disabled: occupied || resource.loading.value || Boolean(resource.error.value),
      refreshDisabled: occupied || resource.loading.value
    }
  })

  watch(modalOpen, (open) => { if (!open) editingUpstream.value = null }, { flush: 'sync' })
  watch(targetModalOpen, (open) => {
    if (!open) {
      targetUpstream.value = null
      editingTarget.value = null
    }
  }, { flush: 'sync' })
  watch(upstreams, () => {
    // A failed read must preserve the editor and its draft for a retry.
    if (resource.error.value || !targetUpstream.value) return
    targetUpstream.value = upstreams.value.find(item => item.id === targetUpstream.value?.id) ?? null
    if (!targetUpstream.value) {
      targetModalOpen.value = false
    } else if (editingTarget.value) {
      editingTarget.value = targetUpstream.value.targets.find(item => item.id === editingTarget.value?.id) ?? null
      if (!editingTarget.value) targetModalOpen.value = false
    }
  })

  function openCreateUpstream() {
    if (controls.value.disabled) return
    editingUpstream.value = null
    modalOpen.value = true
  }

  function openEditUpstream(upstream: PlatformUpstream) {
    if (controls.value.disabled) return
    editingUpstream.value = upstream
    modalOpen.value = true
  }

  function openTarget(upstream: PlatformUpstream, target: PlatformUpstreamTarget | null = null) {
    if (controls.value.disabled) return
    targetUpstream.value = upstream
    editingTarget.value = target
    targetModalOpen.value = true
  }

  async function refreshUpstreams() {
    await lifecycle.capture().execute({
      request: async () => {
        const result = await resource.refresh()
        if (result.status === 'error') throw result.error
      },
      reject: (error) => { toast.add({ title: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' }) }
    }).catch(() => false)
  }

  async function refresh() {
    if (!controls.value.refreshDisabled) await refreshUpstreams()
  }

  async function confirmUpstream(action: 'toggle' | 'remove', upstream: PlatformUpstream): Promise<boolean> {
    if (controls.value.disabled) return false
    const id = upstream.id
    const status = upstream.status === 'active' ? 'disabled' : 'active'
    return confirm({
      ...(action === 'toggle' ? {
        title: t('admin.apis.routing.toggleUpstream.title', { name: upstream.name }),
        description: t('admin.apis.routing.toggleUpstream.description'),
        confirmLabel: t(status === 'active' ? 'common.actions.enable' : 'common.actions.disable'),
        confirmColor: status === 'active' ? 'primary' as const : 'warning' as const
      } : {
        title: t('admin.apis.routing.deleteUpstream.title', { name: upstream.name }),
        description: t('admin.apis.routing.deleteUpstream.description'),
        confirmColor: 'error' as const
      }),
      mutate: () => $fetch(`/api/admin/v1/upstreams/${id}`,
        action === 'toggle' ? { method: 'PATCH', body: { status } } : { method: 'DELETE' }
      ),
      onError: (error) => {
        toast.add({
          title: parseFetchError(error, t(action === 'toggle' ? 'common.feedback.operationFailed' : 'common.feedback.deleteFailed'), {
            UPSTREAM_STILL_PUBLISHED: t('admin.apis.routing.deleteUpstream.stillPublished')
          }),
          color: 'error'
        })
      },
      onSuccess: async () => {
        toast.add({ title: t(action === 'toggle' ? 'common.feedback.updated' : 'common.feedback.deleted'), color: 'success' })
        await refreshUpstreams()
      }
    })
  }

  async function saveTarget(upstreamId: string, target: PlatformUpstreamTarget | null, values: TargetFormValues) {
    if (!targetModalOpen.value || targetUpstream.value?.id !== upstreamId || editingTarget.value?.id !== target?.id) return false
    return targetOperations.save(upstreamId, target, values)
  }

  return {
    resource, upstreams, controls, modalOpen, editingUpstream, targetModalOpen, targetUpstream, editingTarget, targetState,
    page: resource.page, pageSize: resource.pageSize, total: resource.total,
    openCreateUpstream, openEditUpstream, openTarget, refresh, saveTarget,
    toggleUpstream: (upstream: PlatformUpstream) => confirmUpstream('toggle', upstream),
    removeUpstream: (upstream: PlatformUpstream) => confirmUpstream('remove', upstream),
    toggleTarget: (target: PlatformUpstreamTarget) => controls.value.disabled ? Promise.resolve(false) : targetOperations.toggle(target),
    removeTarget: (target: PlatformUpstreamTarget) => controls.value.disabled ? Promise.resolve(false) : targetOperations.remove(target)
  }
}
