// Nuxt UI slot markers belong in app.config: unlike UTheme defaults, they
// survive local ui overrides and do not move from dialog content to its trigger.
export const appUi = {
  button: { slots: { base: 'design-button' } },
  input: { slots: { root: 'design-input', base: 'design-form-control' } },
  inputNumber: { slots: { root: 'design-input-number', base: 'design-form-control' } },
  inputTags: { slots: { root: 'design-input-tags', input: 'design-form-control', itemDelete: 'design-button' } },
  inputTime: { slots: { base: 'design-form-control' } },
  textarea: { slots: { base: 'design-form-control' } },
  select: { slots: { base: 'design-form-control', content: 'design-floating-panel' } },
  selectMenu: { slots: { base: 'design-form-control', content: 'design-floating-panel' } },
  inputMenu: { slots: { base: 'design-form-control', content: 'design-floating-panel' } },
  modal: { slots: { content: 'design-dialog' } },
  slideover: { slots: { content: 'design-slideover' } },
  popover: { slots: { content: 'design-floating-panel' } },
  dropdownMenu: { slots: { content: 'design-floating-panel' } },
  tooltip: { slots: { content: 'design-floating-panel' } }
} as const

export type AppTheme = 'public' | 'auth' | 'dashboard'

export function resolveAppTheme(meta: { layout?: unknown, appTheme?: AppTheme }): AppTheme {
  if (meta.appTheme) return meta.appTheme
  const layout = meta.layout
  return layout === 'dashboard' || (typeof layout === 'object' && layout !== null && 'name' in layout && layout.name === 'dashboard')
    ? 'dashboard' : 'public'
}

const authUi = {
  authForm: { form: 'space-y-4' },
  button: { base: 'auth-button' },
  input: {
    root: 'auth-input-wrapper',
    base: 'auth-input',
    trailing: 'auth-input-trailing'
  },
  formField: { label: 'text-sm font-medium' },
  checkbox: {
    root: 'w-full items-center',
    wrapper: 'min-w-0',
    label: 'auth-checkbox-label cursor-pointer text-xs leading-4 font-normal text-muted'
  }
} as const

export const appThemeUi = {
  public: {},
  auth: authUi,
  dashboard: { modal: { title: 'text-lg font-semibold tracking-tight', description: 'text-sm leading-5' } }
} as const
