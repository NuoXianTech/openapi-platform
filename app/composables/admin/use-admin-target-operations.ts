import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import type { PlatformUpstreamTarget } from '#shared/types/platform'
import { parseFetchError } from '~/utils/client-error'
import { useConfirmedOperation } from '~/composables/use-confirmed-operation'
import type { PrivateReadResult } from '~/composables/dashboard/use-private-resource'

export interface TargetFormValues {
  baseUrl: string
  weight: number
  enabled: boolean
}

const feedbackKeys = {
  create: { success: 'admin.apis.routing.feedback.targetCreated', failure: 'common.feedback.operationFailed' },
  update: { success: 'admin.apis.routing.feedback.targetUpdated', failure: 'common.feedback.operationFailed' },
  toggle: { success: 'common.feedback.updated', failure: 'common.feedback.operationFailed' },
  remove: { success: 'common.feedback.deleted', failure: 'common.feedback.deleteFailed' }
} as const

export function useAdminTargetOperations(options: {
  refresh: () => Promise<PrivateReadResult> | Promise<void>
  isBlocked: () => boolean
  context?: () => unknown
}) {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirmedOperation(options.context)
  const active = ref<'save' | 'confirmation' | null>(null)
  const disposed = ref(false)
  let generation = 0
  if (options.context) watch(options.context, () => { generation += 1; active.value = null }, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => { disposed.value = true; generation += 1; active.value = null })
  const state = computed(() => ({
    busy: active.value !== null,
    saving: active.value === 'save',
    disabled: disposed.value || active.value !== null || options.isBlocked()
  }))

  async function reportSuccess(action: keyof typeof feedbackKeys) {
    const startedGeneration = generation
    toast.add({ title: t(feedbackKeys[action].success), color: 'success' })
    try {
      const result = await options.refresh()
      if (result?.status === 'error') throw result.error
    } catch (error: unknown) {
      // The mutation succeeded. A read failure must not invite another mutation.
      if (!disposed.value && generation === startedGeneration) {
        toast.add({ title: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' })
      }
    }
  }

  function reportError(action: keyof typeof feedbackKeys, error: unknown) {
    toast.add({ title: parseFetchError(error, t(feedbackKeys[action].failure)), color: 'error' })
  }

  async function execute(action: keyof typeof feedbackKeys, mutate: () => Promise<unknown>) {
    const startedGeneration = generation
    const isCurrent = () => !disposed.value && generation === startedGeneration
    try {
      await mutate()
    } catch (error: unknown) {
      if (isCurrent()) reportError(action, error)
      throw error
    }
    if (!isCurrent()) return false
    await reportSuccess(action)
    return isCurrent()
  }

  async function save(upstreamId: string, target: PlatformUpstreamTarget | null, values: TargetFormValues): Promise<boolean> {
    if (state.value.disabled) return false
    const targetId = target?.id
    const body = { baseUrl: values.baseUrl.trim(), weight: values.weight, enabled: values.enabled }
    active.value = 'save'
    const startedGeneration = generation
    try {
      return await execute(targetId ? 'update' : 'create', () => $fetch(
        targetId ? `/api/admin/v1/targets/${targetId}` : `/api/admin/v1/upstreams/${upstreamId}/targets`,
        { method: targetId ? 'PATCH' : 'POST', body }
      ))
    } catch {
      return false
    } finally {
      if (generation === startedGeneration) active.value = null
    }
  }

  async function confirmTarget(action: 'toggle' | 'remove', target: PlatformUpstreamTarget): Promise<boolean> {
    if (state.value.disabled) return false
    const targetId = target.id
    const enabled = !target.enabled
    active.value = 'confirmation'
    const startedGeneration = generation
    try {
      return await confirm({
        ...(action === 'toggle' ? {
          title: t('admin.apis.routing.toggleTarget.title', { name: target.baseUrl }),
          description: t('admin.apis.routing.toggleTarget.description'),
          confirmLabel: t(enabled ? 'common.actions.enable' : 'common.actions.disable'),
          confirmColor: enabled ? 'primary' as const : 'warning' as const
        } : {
          title: t('admin.apis.routing.deleteTarget.title'),
          description: t('admin.apis.routing.deleteTarget.description'),
          confirmColor: 'error' as const
        }),
        mutate: () => $fetch(`/api/admin/v1/targets/${targetId}`,
          action === 'toggle' ? { method: 'PATCH', body: { enabled } } : { method: 'DELETE' }
        ),
        onError: error => reportError(action, error),
        onSuccess: () => reportSuccess(action)
      })
    } finally {
      if (generation === startedGeneration) active.value = null
    }
  }

  return {
    state,
    save,
    toggle: (target: PlatformUpstreamTarget) => confirmTarget('toggle', target),
    remove: (target: PlatformUpstreamTarget) => confirmTarget('remove', target)
  }
}
