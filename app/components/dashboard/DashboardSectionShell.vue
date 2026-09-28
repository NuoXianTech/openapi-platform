<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

interface DashboardSectionShellProps {
  id: string
  title: string
  items: NavigationMenuItem[]
  fixedContent?: boolean
}

const props = defineProps<DashboardSectionShellProps>()

useHead({ title: () => props.title })
</script>

<template>
  <UDashboardPanel :id="id">
    <template #header>
      <UDashboardNavbar class="dashboard-navbar dashboard-section-navbar">
        <template #leading>
          <UDashboardSidebarCollapse />
          <div class="dashboard-section-title min-w-0">
            <h1 class="truncate text-base leading-5 font-semibold text-highlighted">
              {{ title }}
            </h1>
          </div>
        </template>
        <template #right>
          <slot name="right">
            <DashboardHeaderActions />
          </slot>
        </template>
      </UDashboardNavbar>
      <UDashboardToolbar class="dashboard-toolbar dashboard-section-toolbar">
        <UNavigationMenu
          :items="items"
          highlight
          color="neutral"
          variant="pill"
          class="dashboard-section-tabs -mx-1 min-w-0 flex-1 overflow-x-auto"
          :ui="{
            list: 'min-w-full w-max',
            item: 'shrink-0',
            link: 'px-2.5 py-1.5 rounded-lg text-sm',
            linkLeadingIcon: 'size-4',
            linkLabel: 'font-medium'
          }"
        />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div
        class="dashboard-section-page"
        :class="{ 'dashboard-section-page-fixed': fixedContent }"
      >
        <CommonPageOutlet />
      </div>
    </template>
  </UDashboardPanel>
</template>
