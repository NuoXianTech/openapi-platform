import type { AsyncDataRequestStatus } from '#app'
import {
  computed,
  getCurrentScope,
  onMounted,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
  type Ref
} from 'vue'

export type PrivateReadResult<TData = unknown>
  = { status: 'success', data: TData }
    | { status: 'error', error: unknown }
    | { status: 'superseded' | 'disposed' }

interface UsePrivateResourceOptions<TData> {
  path: MaybeRefOrGetter<string>
  defaultData: () => TData
  immediate?: boolean
  query?: MaybeRefOrGetter<Record<string, unknown> | undefined>
  timeoutMs?: number
  validate?: (value: unknown) => void
  resetOnError?: boolean
}

interface UsePrivateResourceReturn<TData> {
  data: Ref<TData>
  status: Ref<AsyncDataRequestStatus>
  loading: ComputedRef<boolean>
  error: Ref<unknown>
  disposed: ComputedRef<boolean>
  refresh: () => Promise<PrivateReadResult<TData>>
  invalidate: () => void
}

export function usePrivateResource<TData>(
  options: UsePrivateResourceOptions<TData>
): UsePrivateResourceReturn<TData> {
  const {
    path,
    defaultData,
    immediate = true,
    query,
    timeoutMs = 15_000,
    validate,
    resetOnError = false
  } = options

  const data = ref(defaultData()) as Ref<TData>
  const status = ref<AsyncDataRequestStatus>(immediate ? 'pending' : 'idle')
  const error = shallowRef<unknown>(null)
  const loading = computed(() => status.value === 'pending')
  const closed = ref(false)
  let requestSeq = 0
  let activeController: AbortController | null = null

  function invalidate(): void {
    requestSeq += 1
    activeController?.abort()
    activeController = null
    status.value = 'idle'
    error.value = null
  }

  async function refresh(): Promise<PrivateReadResult<TData>> {
    if (closed.value) return { status: 'disposed' }
    const seq = ++requestSeq
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    status.value = 'pending'
    error.value = null
    try {
      const result = await $fetch<TData>(toValue(path), {
        query: toValue(query),
        signal: controller.signal,
        timeout: timeoutMs
      })
      if (closed.value) return { status: 'disposed' }
      if (seq !== requestSeq) return { status: 'superseded' }
      validate?.(result)
      data.value = (result ?? defaultData()) as TData
      status.value = 'success'
      return { status: 'success', data: data.value }
    } catch (err) {
      if (closed.value) return { status: 'disposed' }
      if (seq !== requestSeq) return { status: 'superseded' }
      if (resetOnError) data.value = defaultData()
      error.value = err
      status.value = 'error'
      return { status: 'error', error: err }
    } finally {
      if (seq === requestSeq && activeController === controller) {
        activeController = null
      }
    }
  }

  if (immediate) {
    onMounted(() => { void refresh() })
  }

  if (getCurrentScope()) {
    onScopeDispose(() => {
      closed.value = true
      invalidate()
    })
  }

  return {
    data,
    disposed: computed(() => closed.value),
    status,
    loading,
    error,
    refresh,
    invalidate
  }
}
