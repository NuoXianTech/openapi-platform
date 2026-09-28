import { computed, ref } from 'vue'
import type { PlatformUpstreamTarget } from '#shared/types/platform'
import { parseFetchError } from '~/utils/client-error'

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
  refresh: () => Promise<void>
  isBlocked: () => boolean
}) {
  const { t } = useI18n()
  const toast = useToast()
  const confirm = useConfirmDialog()
  const active = ref<'save' | 'confirmation' | null>(null)
  const state = computed(() => ({
    busy: active.value !== null,
    saving: active.value === 'save',
    disabled: active.value !== null || options.isBlocked()
  }))

  async function execute(action: keyof typeof feedbackKeys, mutate: () => Promise<unknown>) {
    try {
      await mutate()
    } catch (error: unknown) {
      toast.add({ title: parseFetchError(error, t(feedbackKeys[action].failure)), color: 'error' })
      // The confirmation dialog must remain open for retry on mutation failure.
      throw error
    }
    toast.add({ title: t(feedbackKeys[action].success), color: 'success' })
    try {
      await options.refresh()
    } catch (error: unknown) {
      // The mutation succeeded. A read failure must not invite another mutation.
      toast.add({ title: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' })
    }
  }

  async function save(upstreamId: string, target: PlatformUpstreamTarget | null, values: TargetFormValues): Promise<boolean> {
    if (state.value.disabled) return false
    const targetId = target?.id
    const body = { baseUrl: values.baseUrl.trim(), weight: values.weight, enabled: values.enabled }
    active.value = 'save'
    try {
      await execute(targetId ? 'update' : 'create', () => $fetch(
        targetId ? `/api/admin/v1/targets/${targetId}` : `/api/admin/v1/upstreams/${upstreamId}/targets`,
        { method: targetId ? 'PATCH' : 'POST', body }
      ))
      return true
    } catch {
      return false
    } finally {
      active.value = null
    }
  }

  async function confirmTarget(action: 'toggle' | 'remove', target: PlatformUpstreamTarget): Promise<boolean> {
    if (state.value.disabled) return false
    const targetId = target.id
    const enabled = !target.enabled
    active.value = 'confirmation'
    let completed = false
    let running: Promise<void> | null = null
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
        onConfirm: () => {
          if (completed) return
          // Keep retries in this admitted confirmation; repeated clicks share a request.
          running ??= execute(action, () => $fetch(`/api/admin/v1/targets/${targetId}`,
            action === 'toggle' ? { method: 'PATCH', body: { enabled } } : { method: 'DELETE' }
          )).then(() => { completed = true }).finally(() => { running = null })
          return running
        }
      })
    } finally {
      active.value = null
    }
  }

  return {
    state,
    save,
    toggle: (target: PlatformUpstreamTarget) => confirmTarget('toggle', target),
    remove: (target: PlatformUpstreamTarget) => confirmTarget('remove', target)
  }
}
