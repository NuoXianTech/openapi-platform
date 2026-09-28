import { getCurrentScope, onScopeDispose, ref, watch } from 'vue'
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
  const loading = ref(false)
  const formError = ref<string | null>(null)
  let generation = 0
  let disposed = false
  watch([context.id, context.open], () => {
    generation += 1
    loading.value = false
    formError.value = null
  }, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; generation += 1 })

  async function save(values: UpstreamFormValues): Promise<boolean> {
    if (disposed || loading.value || !context.open()) return false
    const id = context.id()
    const started = generation
    const isCurrent = () => !disposed && generation === started
    const details = { name: values.name.trim(), slug: values.slug.trim(), loadBalancing: values.loadBalancing }
    const serviceToken = values.serviceToken.trim()
    loading.value = true
    formError.value = null
    try {
      await $fetch(id ? `/api/admin/v1/upstreams/${id}` : '/api/admin/v1/upstreams', {
        method: id ? 'PATCH' : 'POST',
        body: id
          ? { ...details, ...(serviceToken ? { serviceToken } : {}) }
          : { ...details, serviceToken, targets: values.targets.map(target => ({ baseUrl: target.baseUrl.trim(), weight: target.weight })) }
      })
      if (!isCurrent()) return false
      toast.add({ title: t(id ? 'admin.apis.routing.feedback.upstreamUpdated' : 'admin.apis.routing.feedback.upstreamCreated'), color: 'success' })
      return true
    } catch (error: unknown) {
      if (isCurrent()) formError.value = parseFetchError(error, t(id ? 'admin.apis.routing.feedback.updateFailed' : 'admin.apis.routing.feedback.createFailed'))
      return false
    } finally {
      if (isCurrent()) loading.value = false
    }
  }
  return { loading, formError, save }
}
