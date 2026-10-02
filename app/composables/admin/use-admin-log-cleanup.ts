import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import type { PrivateReadResult } from '~/composables/dashboard/use-private-resource'

interface UseAdminLogCleanupOptions {
  endpoint: string
  // Starts the list read synchronously, using the current filter draft.
  applyFilters: () => Promise<PrivateReadResult<{ total: number }>>
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
  let pendingFilters: Record<string, unknown> | null = null
  const generation = ref(0)
  let disposed = false

  function invalidate() {
    generation.value += 1
    pendingFilters = null
  }

  watch(cleanupOpen, (open) => {
    if (!open) invalidate()
  }, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => {
    disposed = true
    invalidate()
    cleanupOpen.value = false
  })

  async function openCleanup() {
    if (disposed || cleanupLoading.value) return
    cleanupOpen.value = false
    invalidate()
    const current = generation.value
    const isCurrent = () => !disposed && generation.value === current
    try {
      // Capture before the list read starts. Draft edits during the request
      // must not replace the predicate whose count the administrator sees.
      const filters = compactFilters(options.buildFilters())
      const result = await options.applyFilters()
      if (!isCurrent()) return
      if (result.status !== 'success') {
        if (result.status === 'error') throw result.error
        return
      }

      const count = result.data.total
      if (!Number.isFinite(count) || count < 0) throw new TypeError('Invalid log cleanup preview')
      if (count === 0) {
        toast.add({ title: t('admin.logs.cleanup.noMatching'), color: 'neutral' })
        return
      }

      pendingFilters = filters
      cleanupMatchCount.value = count
      cleanupHasFilters.value = Object.keys(filters).length > 0
      cleanupOpen.value = true
    } catch (error) {
      if (isCurrent()) toast.add({ title: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' })
    }
  }

  async function executeCleanup(current: number): Promise<boolean> {
    const isCurrent = () => !disposed && generation.value === current && cleanupOpen.value
    if (!isCurrent() || !pendingFilters || cleanupLoading.value) return false
    const filters = pendingFilters

    cleanupLoading.value = true
    try {
      let result: { affected: number }
      try {
        result = await $fetch<{ affected: number }>(options.endpoint, {
          method: 'POST',
          body: {
            ...filters,
            confirm: true,
            deleteAll: Object.keys(filters).length === 0
          }
        })
      } catch (error) {
        if (isCurrent()) toast.add({
          title: parseFetchError(error, t('admin.logs.cleanup.failed')),
          color: 'error'
        })
        return false
      }

      // Consume the successful mutation before any refresh, even if the page
      // goes away or a caller retains and invokes this confirmation again.
      pendingFilters = null
      if (!isCurrent()) return false
      toast.add({
        title: t('admin.logs.cleanup.success', { count: result.affected }),
        color: 'success'
      })
      try {
        const refreshed = await options.refresh()
        if (refreshed?.status === 'error') throw refreshed.error
      } catch (error) {
        if (isCurrent()) console.error('failed to refresh logs after cleanup', { endpoint: options.endpoint, error })
      }
      return isCurrent()
    } finally {
      cleanupLoading.value = false
    }
  }

  // The modal receives a callback bound to its preview. A retained callback
  // cannot confirm a different preview opened after cancellation or completion.
  const confirmCleanup = computed(() => {
    const current = generation.value
    return () => executeCleanup(current)
  })

  return {
    cleanupHasFilters,
    cleanupLoading,
    cleanupMatchCount,
    cleanupOpen,
    confirmCleanup,
    openCleanup
  }
}
