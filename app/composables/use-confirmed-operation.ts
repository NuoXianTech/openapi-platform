import { getCurrentScope, onScopeDispose, watch } from 'vue'
import type { ConfirmDialogOptions } from '~/composables/use-confirm-dialog'

interface ConfirmedOperationOptions extends Omit<ConfirmDialogOptions, 'onConfirm'> {
  mutate: () => Promise<unknown>
  onSuccess: () => void | Promise<void>
  onError: (error: unknown) => void
}

/** Own the admitted confirmation until it completes, is cancelled, or loses
 * its context. A completed mutation is never replayed to recover a failed read. */
export function useConfirmedOperation(context?: () => unknown) {
  const confirm = useConfirmDialog()
  let disposed = false
  let generation = 0
  let active: object | null = null
  if (context) watch(context, () => { generation += 1; active = null }, { flush: 'sync' })
  if (getCurrentScope()) onScopeDispose(() => { disposed = true; active = null })

  return async ({ mutate, onSuccess, onError, ...dialog }: ConfirmedOperationOptions): Promise<boolean> => {
    if (disposed || active) return false
    const operation = { generation }
    active = operation
    const isCurrent = () => !disposed && active === operation && generation === operation.generation
    let completed = false
    let running: Promise<void> | null = null
    try {
      const answer = await confirm({
        ...dialog,
        onConfirm: () => {
          if (!isCurrent()) return
          if (running) return running
          if (completed) return
          running = (async () => {
            try {
              await mutate()
            } catch (error: unknown) {
              if (isCurrent()) onError(error)
              throw error
            }
            completed = true
            if (isCurrent()) await onSuccess()
          })().finally(() => { running = null })
          return running
        }
      })
      return answer && completed && isCurrent()
    } finally {
      if (active === operation) active = null
    }
  }
}
