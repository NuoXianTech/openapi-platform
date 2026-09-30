export default defineAppConfig({
  ui: {
    colors: {
      primary: 'zinc',
      secondary: 'zinc',
      neutral: 'zinc'
    },
    icons: {
      arrowDown: 'i-mdi-arrow-down',
      arrowLeft: 'i-mdi-arrow-left',
      arrowRight: 'i-mdi-arrow-right',
      arrowUp: 'i-mdi-arrow-up',
      caution: 'i-mdi-alert-outline',
      check: 'i-mdi-check',
      chevronDoubleLeft: 'i-mdi-chevron-double-left',
      chevronDoubleRight: 'i-mdi-chevron-double-right',
      chevronDown: 'i-mdi-chevron-down',
      chevronLeft: 'i-mdi-chevron-left',
      chevronRight: 'i-mdi-chevron-right',
      chevronUp: 'i-mdi-chevron-up',
      close: 'i-mdi-close',
      copy: 'i-mdi-content-copy',
      copyCheck: 'i-mdi-clipboard-check-outline',
      dark: 'i-mdi-weather-night',
      drag: 'i-mdi-drag-vertical',
      ellipsis: 'i-mdi-dots-horizontal',
      error: 'i-mdi-alert-circle-outline',
      external: 'i-mdi-open-in-new',
      eye: 'i-mdi-eye-outline',
      eyeOff: 'i-mdi-eye-off-outline',
      file: 'i-mdi-file-outline',
      folder: 'i-mdi-folder-outline',
      folderOpen: 'i-mdi-folder-open-outline',
      hash: 'i-mdi-pound',
      info: 'i-mdi-information-outline',
      light: 'i-mdi-white-balance-sunny',
      loading: 'i-lucide-loader-circle',
      menu: 'i-mdi-menu',
      minus: 'i-mdi-minus',
      panelClose: 'i-mdi-arrow-collapse-left',
      panelOpen: 'i-mdi-arrow-expand-right',
      plus: 'i-mdi-plus',
      reload: 'i-lucide-refresh-cw',
      search: 'i-mdi-magnify',
      star: 'i-mdi-star-outline',
      stop: 'i-mdi-stop',
      success: 'i-mdi-check-circle-outline',
      system: 'i-mdi-monitor',
      tip: 'i-mdi-lightbulb-outline',
      upload: 'i-mdi-upload',
      warning: 'i-mdi-alert-outline'
    },
    badge: {
      variants: {
        size: {
          xs: { base: 'text-xs/4 px-1 py-0.5 gap-1 rounded-sm' },
          sm: { base: 'text-xs/4 px-1.5 py-0.5 gap-1 rounded-sm' }
        }
      },
      compoundVariants: [
        {
          color: ['info', 'success'],
          variant: ['outline', 'soft', 'subtle'],
          class: 'text-(--design-badge-info)'
        },
        {
          color: 'error',
          variant: ['outline', 'soft', 'subtle'],
          class: 'text-(--design-badge-error)'
        },
        {
          color: 'warning',
          variant: ['outline', 'soft', 'subtle'],
          class: 'text-(--design-badge-warning)'
        },
        {
          color: 'warning',
          variant: ['soft', 'subtle'],
          class: 'bg-(--design-badge-warning-bg)'
        }
      ]
    },
    collapsible: {
      slots: {
        content: 'motion-reduce:animate-none'
      }
    },
    card: {
      slots: {
        root: 'rounded-lg overflow-hidden shadow-none',
        header: 'p-4 sm:px-5',
        title: 'text-highlighted font-semibold',
        description: 'mt-1 text-muted text-sm',
        body: 'p-4 sm:p-5',
        footer: 'p-4 sm:px-5'
      },
      variants: {
        variant: {
          outline: {
            root: 'border border-default bg-elevated divide-y divide-default ring-0 shadow-[0_1px_2px_color-mix(in_oklab,var(--ui-text)_4%,transparent)]'
          },
          soft: {
            root: 'border border-default bg-elevated divide-y divide-default ring-0'
          },
          subtle: {
            root: 'border border-default bg-elevated divide-y divide-default ring-0'
          }
        }
      },
      defaultVariants: {
        variant: 'outline'
      }
    },
    table: {
      slots: {
        root: 'relative overflow-auto',
        base: 'min-w-full overflow-clip',
        caption: 'sr-only',
        thead: 'relative',
        tbody: 'isolate [&>tr]:data-[selectable=true]:hover:bg-elevated/50 [&>tr]:data-[selectable=true]:focus-visible:outline-primary divide-y divide-default',
        tfoot: 'relative',
        tr: 'data-[selected=true]:bg-elevated/50',
        th: 'px-3 py-2.5 text-xs text-toned text-left rtl:text-right font-semibold tracking-[0.01em] [&:has([role=checkbox])]:pe-0',
        td: 'px-3 py-3 text-[13px] leading-5 text-default whitespace-nowrap [&:has([role=checkbox])]:pe-0',
        separator: 'absolute z-1 left-0 w-full h-px bg-(--ui-border-accented)',
        empty: 'py-6 text-center text-sm text-muted',
        loading: 'py-6 text-center'
      }
    }
  }
})
