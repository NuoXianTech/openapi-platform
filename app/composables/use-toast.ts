import { useToast as useNuxtToast, type Toast } from '@nuxt/ui/composables/useToast'

// Registered with higher import priority in nuxt.config.ts. Keep the native
// store and lifecycle while giving every existing useToast() call our defaults.
export function useToast() {
  const toast = useNuxtToast()
  const appConfig = useAppConfig()

  function add(options: Partial<Toast>) {
    const color = options.color ?? 'neutral'
    const status = color === 'success' || color === 'warning' || color === 'error' ? color : 'info'

    return toast.add({
      ...options,
      color,
      icon: options.icon ?? appConfig.ui.icons[status],
      actions: options.actions?.map(action => ({ color: 'neutral', variant: 'outline', ...action })),
      // Actionable notices stay available; callers can always set a duration,
      // including zero for important notices that must be dismissed manually.
      duration: options.duration ?? (options.actions?.length ? 0 : color === 'success' ? 3000 : color === 'error' ? 7000 : 5000)
    })
  }

  return { ...toast, add }
}
