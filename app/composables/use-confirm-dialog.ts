import type { ButtonProps } from '@nuxt/ui'
import { LazyCommonAppConfirmDialog } from '#components'

export interface ConfirmDialogOptions {
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: ButtonProps['color']
  /**
   * 可选的确认动作。提供时弹窗内部托管 loading：
   *   - resolve 后弹窗关闭，await 返回 true
   *   - reject  时弹窗保持打开，调用方需自行 toast 错误
   */
  onConfirm?: () => Promise<void> | void
}

export function useConfirmDialog() {
  const overlay = useOverlay()

  return async (options: ConfirmDialogOptions): Promise<boolean> => {
    const modal = overlay.create(LazyCommonAppConfirmDialog, {
      destroyOnClose: true,
      props: options
    })
    const result = await modal.open()
    return result === true
  }
}
