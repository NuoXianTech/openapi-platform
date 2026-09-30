<script setup lang="ts">
import {
  createAdminDashboardConfig,
  createUserDashboardConfig,
  type DashboardConfig,
  type DashboardStaticConfig
} from '~/constants/dashboard-config'

interface DashboardLayoutProps {
  dashboardId: DashboardConfig['id']
}

const props = defineProps<DashboardLayoutProps>()
const { user } = useAuth()
const { t } = useI18n()

const dashboardUi = {
  button: { base: 'dashboard-button' },
  input: { base: 'dashboard-form-control' },
  textarea: { base: 'dashboard-form-control' },
  select: {
    base: 'dashboard-form-control',
    content: 'dashboard-floating-panel'
  },
  selectMenu: {
    base: 'dashboard-form-control',
    content: 'dashboard-floating-panel'
  },
  inputMenu: {
    base: 'dashboard-form-control',
    content: 'dashboard-floating-panel'
  },
  card: { root: 'dashboard-card' },
  modal: {
    content: 'dashboard-dialog',
    title: 'text-lg font-semibold tracking-tight',
    description: 'text-sm leading-5'
  },
  popover: { content: 'dashboard-floating-panel' },
  dropdownMenu: { content: 'dashboard-floating-panel' },
  tooltip: { content: 'dashboard-floating-panel' }
} as const

// Modal/card class defaults merge with local classes, even when a page supplies
// its own ui.content or ui.root (for example, a custom dialog width).
const dashboardProps = {
  card: { class: 'dashboard-card' },
  modal: { class: 'dashboard-dialog' }
}

const dashboardConfig = computed<DashboardStaticConfig>(() => resolveDashboardConfig(props.dashboardId))

function resolveDashboardConfig(dashboardId: DashboardConfig['id']): DashboardStaticConfig {
  const context = { t, isAdmin: user.value?.role === 'admin' }

  return dashboardId === 'admin'
    ? createAdminDashboardConfig(context)
    : createUserDashboardConfig(context)
}
</script>

<template>
  <UTheme :ui="dashboardUi" :props="dashboardProps">
    <DashboardLayoutBase :config="dashboardConfig">
      <slot />
    </DashboardLayoutBase>
  </UTheme>
</template>
