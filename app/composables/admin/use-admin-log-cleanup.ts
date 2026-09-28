import { ref, type Ref } from 'vue'
import type { PrivateReadResult } from '~/composables/dashboard/use-private-resource'

interface UseAdminLogCleanupOptions {
  endpoint: string
  total: Ref<number>
  applyFilters: () => Promise<PrivateReadResult>
  refresh: () => Promise<PrivateReadResult>
  buildFilters: () => Record<string, unknown>
}

function compactFilters(filters: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).flatMap(([key, value]) => {
      if (value === undefined || value === null || value === '') return []
      if (Array.isArray(value)) return value.length ? [[key, [...value]]] : []
      return [[key, value]]
    })
  )
}

export function useAdminLogCleanup(options: UseAdminLogCleanupOptions) {
  const { t } = useI18n()
  const toast = useToast()
  const cleanupOpen = ref(false)
  const cleanupMatchCount = ref(0)
  const cleanupHasFilters = ref(false)
  const cleanupLoading = ref(false)
  const pendingFilters = ref<Record<string, unknown>>({})

  async function openCleanup() {
    const result = await options.applyFilters()
    if (result.status !== 'success') {
      if (result.status === 'error') toast.add({ title: parseFetchError(result.error, t('common.feedback.loadFailed')), color: 'error' })
      return
    }

    if (options.total.value === 0) {
      toast.add({ title: t('admin.logs.cleanup.noMatching'), color: 'neutral' })
      return
    }

    pendingFilters.value = compactFilters(options.buildFilters())
    cleanupMatchCount.value = options.total.value
    cleanupHasFilters.value = Object.keys(pendingFilters.value).length > 0
    cleanupOpen.value = true
  }

  async function confirmCleanup(): Promise<boolean> {
    if (cleanupLoading.value) return false

    cleanupLoading.value = true
    try {
      let result: { affected: number }
      try {
        result = await $fetch<{ affected: number }>(options.endpoint, {
          method: 'POST',
          body: {
            ...pendingFilters.value,
            confirm: true,
            deleteAll: !cleanupHasFilters.value
          }
        })
      } catch (error) {
        toast.add({
          title: parseFetchError(error, t('admin.logs.cleanup.failed')),
          color: 'error'
        })
        return false
      }

      toast.add({
        title: t('admin.logs.cleanup.success', { count: result.affected }),
        color: 'success'
      })
      try {
        const refreshed = await options.refresh()
        if (refreshed?.status === 'error') throw refreshed.error
      } catch (error) {
        console.error('failed to refresh logs after cleanup', { endpoint: options.endpoint, error })
      }
      return true
    } finally {
      cleanupLoading.value = false
    }
  }

  return {
    cleanupHasFilters,
    cleanupLoading,
    cleanupMatchCount,
    cleanupOpen,
    confirmCleanup,
    openCleanup
  }
}
