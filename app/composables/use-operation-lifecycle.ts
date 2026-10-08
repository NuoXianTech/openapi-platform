import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type WatchSource } from 'vue'

interface OperationStep<T> {
  request: () => Promise<T>
  accept?: (result: T) => void | Promise<void>
  reject?: (error: unknown) => void | Promise<void>
}

interface OperationScope {
  execute: <T>(step: OperationStep<T>) => Promise<boolean>
}

export type OperationLifecycle = ReturnType<typeof useOperationLifecycle>

/** One owner for admission and context validity, shared by direct and confirmed
 * writes. Domain modules own the steps; late steps cannot apply effects. */
export function useOperationLifecycle(options: {
  context?: WatchSource | WatchSource[]
  onInvalidate?: () => void
} = {}) {
  let context = {}
  const active = shallowRef<{ kind: string } | null>(null)
  const disposed = ref(false)

  function invalidate() {
    context = {}
    active.value = null
    options.onInvalidate?.()
  }
  if (options.context) watch(options.context, invalidate, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => { disposed.value = true; invalidate() })

  function capture(operation?: object): OperationScope {
    const startedContext = context
    const isCurrent = () => !disposed.value && context === startedContext
      && (operation === undefined || active.value === operation)
    return {
      async execute({ request, accept, reject }) {
        if (!isCurrent()) return false
        let result
        try {
          result = await request()
        } catch (error: unknown) {
          if (isCurrent()) await reject?.(error)
          throw error
        }
        if (!isCurrent()) return false
        await accept?.(result)
        return isCurrent()
      }
    }
  }

  async function run(kind: string, work: (scope: OperationScope) => Promise<boolean>): Promise<boolean> {
    if (disposed.value || active.value !== null) return false
    const operation = { kind }
    active.value = operation
    try {
      const accepted = await work(capture(operation))
      return accepted && !disposed.value && active.value === operation
    } finally {
      if (active.value === operation) active.value = null
    }
  }

  return {
    active: computed(() => active.value?.kind ?? null),
    disposed: computed(() => disposed.value),
    run,
    // Follow-up read effects share context validity, without reserving a write.
    capture: () => capture()
  }
}
