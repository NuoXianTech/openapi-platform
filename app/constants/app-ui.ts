// UApp owns the programmatic overlay provider, so its theme must be provided
// above UApp rather than inside an individual page layout.
export const dashboardUi = {
  button: { base: 'dashboard-button' },
  input: { root: 'design-input', base: 'dashboard-form-control' },
  inputNumber: { root: 'design-input-number', base: 'dashboard-form-control' },
  inputTime: { base: 'dashboard-form-control' },
  textarea: { base: 'dashboard-form-control' },
  select: { base: 'dashboard-form-control', content: 'dashboard-floating-panel' },
  selectMenu: { base: 'dashboard-form-control', content: 'dashboard-floating-panel' },
  inputMenu: { base: 'dashboard-form-control', content: 'dashboard-floating-panel' },
  card: { root: 'dashboard-card' },
  modal: {
    content: 'dashboard-dialog',
    title: 'text-lg font-semibold tracking-tight',
    description: 'text-sm leading-5'
  },
  slideover: { content: 'dashboard-slideover' },
  popover: { content: 'dashboard-floating-panel' },
  dropdownMenu: { content: 'dashboard-floating-panel' },
  tooltip: { content: 'dashboard-floating-panel' }
} as const

// Class defaults preserve cards and dialogs without trigger slots. Components
// with a trigger slot must also retain the theme class in their local ui.content.
export const dashboardThemeProps = {
  card: { class: 'dashboard-card' },
  modal: { class: 'dashboard-dialog' },
  slideover: { class: 'dashboard-slideover' }
}

export const publicUi = {
  button: { base: 'public-button' },
  input: { root: 'design-input' },
  modal: { content: 'design-dialog' },
  popover: { content: 'design-floating-panel' },
  dropdownMenu: { content: 'design-floating-panel' },
  tooltip: { content: 'design-floating-panel' }
} as const

export const publicThemeProps = {
  modal: { class: 'design-dialog' }
}
