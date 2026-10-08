import { computed, ref } from 'vue'
import { useOperationLifecycle } from '~/composables/use-operation-lifecycle'
import { parseFetchError } from '~/utils/client-error'

export interface UpstreamFormValues {
  name: string
  slug: string
  serviceToken: string
  loadBalancing: 'round_robin' | 'weighted'
  targets: Array<{ baseUrl: string, weight: number }>
}

export function useAdminUpstreamEditor(context: { id: () => string | undefined, open: () => boolean }) {
  const { t } = useI18n()
  const toast = useToast()
  const formError = ref<string | null>(null)
  const lifecycle = useOperationLifecycle({
    context: [context.id, context.open],
    onInvalidate: () => { formError.value = null }
  })
  const loading = computed(() => lifecycle.active.value !== null)

  async function save(values: UpstreamFormValues): Promise<boolean> {
    if (lifecycle.disposed.value || loading.value || !context.open()) return false
    const id = context.id()
    const details = { name: values.name.trim(), slug: values.slug.trim(), loadBalancing: values.loadBalancing }
    const serviceToken = values.serviceToken.trim()
    formError.value = null
    return lifecycle.run('save', operation => operation.execute({
      request: () => $fetch(id ? `/api/admin/v1/upstreams/${id}` : '/api/admin/v1/upstreams', {
        method: id ? 'PATCH' : 'POST',
        body: id
          ? { ...details, ...(serviceToken ? { serviceToken } : {}) }
          : { ...details, serviceToken, targets: values.targets.map(target => ({ baseUrl: target.baseUrl.trim(), weight: target.weight })) }
      }),
      accept: () => {
        toast.add({ title: t(id ? 'admin.apis.routing.feedback.upstreamUpdated' : 'admin.apis.routing.feedback.upstreamCreated'), color: 'success' })
      },
      reject: (error) => { formError.value = parseFetchError(error, t(id ? 'admin.apis.routing.feedback.updateFailed' : 'admin.apis.routing.feedback.createFailed')) }
    })).catch(() => false)
  }

  return { loading, formError, save }
}
