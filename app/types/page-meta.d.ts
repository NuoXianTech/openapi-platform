import type { AppTheme } from '~/constants/app-ui'

declare module '#app' {
  interface PageMeta {
    appTheme?: AppTheme
  }
}

export {}
