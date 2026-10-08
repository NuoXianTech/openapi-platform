import { computed } from 'vue'
import { useOperationLifecycle } from '~/composables/use-operation-lifecycle'
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
  const lifecycle = useOperationLifecycle({ context: options.context })
  const confirm = useConfirmedOperation(undefined, lifecycle)
  const { active, disposed } = lifecycle
  const state = computed(() => ({
    busy: active.value !== null,
    saving: active.value === 'save',
    disabled: disposed.value || active.value !== null || options.isBlocked()
  }))

  async function reportSuccess(action: keyof typeof feedbackKeys) {
    const effects = lifecycle.capture()
    toast.add({ title: t(feedbackKeys[action].success), color: 'success' })
    await effects.execute({
      request: async () => {
        const result = await options.refresh()
        if (result?.status === 'error') throw result.error
      },
      reject: (error) => { toast.add({ title: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' }) }
    }).catch(() => false)
  }

  function reportError(action: keyof typeof feedbackKeys, error: unknown) {
    toast.add({ title: parseFetchError(error, t(feedbackKeys[action].failure)), color: 'error' })
  }

  async function save(upstreamId: string, target: PlatformUpstreamTarget | null, values: TargetFormValues): Promise<boolean> {
    if (state.value.disabled) return false
    const targetId = target?.id
    const body = { baseUrl: values.baseUrl.trim(), weight: values.weight, enabled: values.enabled }
    const action = targetId ? 'update' : 'create'
    return lifecycle.run('save', operation => operation.execute({
      request: () => $fetch(
        targetId ? `/api/admin/v1/targets/${targetId}` : `/api/admin/v1/upstreams/${upstreamId}/targets`,
        { method: targetId ? 'PATCH' : 'POST', body }
      ),
      accept: () => reportSuccess(action),
      reject: error => reportError(action, error)
    })).catch(() => false)
  }

  async function confirmTarget(action: 'toggle' | 'remove', target: PlatformUpstreamTarget): Promise<boolean> {
    if (state.value.disabled) return false
    const targetId = target.id
    const enabled = !target.enabled
    return confirm({
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
  }

  return {
    state,
    save,
    toggle: (target: PlatformUpstreamTarget) => confirmTarget('toggle', target),
    remove: (target: PlatformUpstreamTarget) => confirmTarget('remove', target)
  }
}
