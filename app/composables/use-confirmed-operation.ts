import type { ConfirmDialogOptions } from '~/composables/use-confirm-dialog'
import { useOperationLifecycle, type OperationLifecycle } from '~/composables/use-operation-lifecycle'

interface ConfirmedOperationOptions extends Omit<ConfirmDialogOptions, 'onConfirm'> {
  mutate: () => Promise<unknown>
  onSuccess: () => void | Promise<void>
  onError: (error: unknown) => void
}

/** Own the admitted confirmation until it completes, is cancelled, or loses
 * its context. A completed mutation is never replayed to recover a failed read. */
export function useConfirmedOperation(context?: () => unknown, owner?: OperationLifecycle) {
  const confirm = useConfirmDialog()
  const lifecycle = owner ?? useOperationLifecycle({ context })

  return async ({ mutate, onSuccess, onError, ...dialog }: ConfirmedOperationOptions): Promise<boolean> => {
    return lifecycle.run('confirmation', async (operation) => {
      let completed = false
      let running: Promise<void> | null = null
      const answer = await confirm({
        ...dialog,
        onConfirm: () => {
          if (running) return running
          if (completed) return
          running = operation.execute({
            request: mutate,
            accept: async () => { completed = true; await onSuccess() },
            reject: onError
          }).then(() => undefined).finally(() => { running = null })
          return running
        }
      })
      return answer && completed
    })
  }
}
