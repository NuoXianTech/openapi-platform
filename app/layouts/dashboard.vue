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

const dashboardConfig = computed<DashboardStaticConfig>(() => resolveDashboardConfig(props.dashboardId))

function resolveDashboardConfig(dashboardId: DashboardConfig['id']): DashboardStaticConfig {
  const context = { t, isAdmin: user.value?.role === 'admin' }

  return dashboardId === 'admin'
    ? createAdminDashboardConfig(context)
    : createUserDashboardConfig(context)
}
</script>

<template>
  <DashboardLayoutBase :config="dashboardConfig">
    <slot />
  </DashboardLayoutBase>
</template>
