<script setup lang="ts">
import type { DashboardStaticConfig } from '~/constants/dashboard-config'
import {
  dashboardConfigInjectionKey,
  type ResolvedDashboardConfig
} from '~/composables/dashboard/use-dashboard-config'

interface DashboardLayoutBaseProps {
  config: DashboardStaticConfig
}

const props = defineProps<DashboardLayoutBaseProps>()

const { settings } = useSiteSettings()

const siteName = computed(() => settings.value?.siteName || 'OpenAPI')

const resolved = computed<ResolvedDashboardConfig>(() => ({
  ...props.config,
  brand: props.config.brand(siteName.value)
}))

provide(dashboardConfigInjectionKey, resolved)

const open = ref(false)

const navigationMenuUi = {
  root: 'dashboard-sidebar-menu',
  list: 'space-y-1',
  item: 'min-w-0',
  link: 'dashboard-sidebar-link min-h-10 rounded-md px-3 py-2',
  linkLeadingIcon: 'dashboard-sidebar-link-icon size-[18px]',
  linkLabel: 'dashboard-sidebar-link-label font-medium',
  linkTrailing: 'dashboard-sidebar-link-trailing',
  label: 'dashboard-sidebar-menu-label'
}
</script>

<template>
  <UDashboardGroup
    class="dashboard-shell dashboard-shell-refined"
    unit="rem"
    :storage-key="`dashboard-${resolved.id}-sidebar-v2`"
  >
    <UDashboardSidebar
      :id="resolved.id"
      v-model:open="open"
      collapsible
      :default-size="15.5"
      :collapsed-size="4.25"
      class="dashboard-sidebar"
      :ui="{
        root: 'border-e-0',
        header: 'h-auto px-3 pb-2.5 pt-3',
        body: 'gap-5 px-3 py-3',
        footer: 'border-t border-default px-3 pb-3 pt-2.5',
        content: 'dashboard-sidebar-panel'
      }"
    >
      <template #header="{ collapsed }">
        <div
          class="dashboard-sidebar-brand"
          :class="{ 'dashboard-sidebar-brand-collapsed': collapsed }"
        >
          <UButton
            :to="resolved.brand.to"
            :aria-label="`${resolved.brand.label} · ${resolved.brand.workspaceLabel}`"
            color="neutral"
            variant="ghost"
            block
            :square="collapsed"
            class="dashboard-brand-trigger"
          >
            <template #leading>
              <span class="dashboard-brand-mark">
                <img
                  :src="settings.siteImg || '/favicon.ico'"
                  alt=""
                  width="26"
                  height="26"
                  decoding="async"
                  class="dashboard-brand-logo"
                >
                <span
                  v-if="collapsed"
                  class="dashboard-brand-context-mark"
                  aria-hidden="true"
                >
                  <UIcon
                    :name="resolved.brand.workspaceIcon"
                    class="dashboard-brand-context-icon"
                  />
                </span>
              </span>
            </template>

            <template v-if="!collapsed" #default>
              <span class="dashboard-brand-copy">
                <span class="dashboard-brand-name">{{ resolved.brand.label }}</span>
                <span class="dashboard-brand-workspace">
                  <UIcon
                    :name="resolved.brand.workspaceIcon"
                    class="dashboard-brand-workspace-icon"
                  />
                  <span>{{ resolved.brand.workspaceLabel }}</span>
                </span>
              </span>
            </template>
          </UButton>
        </div>
      </template>

      <template #default="{ collapsed }">
        <div
          v-for="(group, gIdx) in resolved.groups"
          :key="gIdx"
          class="dashboard-sidebar-nav-group"
        >
          <div
            v-if="group.label && !collapsed"
            class="dashboard-sidebar-group-label"
          >
            {{ group.label }}
          </div>
          <UNavigationMenu
            :collapsed="collapsed"
            :items="group.items"
            orientation="vertical"
            color="neutral"
            variant="pill"
            :tooltip="collapsed"
            :ui="navigationMenuUi"
          />
        </div>
      </template>

      <template #footer="{ collapsed }">
        <UNavigationMenu
          :collapsed="collapsed"
          :items="resolved.footerLinks"
          orientation="vertical"
          color="neutral"
          variant="pill"
          class="dashboard-sidebar-footer-menu"
          :tooltip="collapsed"
          :ui="navigationMenuUi"
        />
      </template>
    </UDashboardSidebar>

    <slot />
  </UDashboardGroup>
</template>

<style>
.dashboard-shell {
  min-height: 100dvh;
  background: var(--ui-bg);
}

.dashboard-shell-refined,
.dashboard-sidebar-panel {
  --dashboard-sidebar-bg: var(--dashboard-surface);
  --dashboard-sidebar-border: var(--ui-border);
  --dashboard-sidebar-hover: var(--ui-bg-muted);
  --dashboard-sidebar-active: var(--ui-bg-muted);
  --dashboard-sidebar-accent: var(--ui-primary);
}

.dashboard-sidebar,
.dashboard-sidebar-panel {
  border-inline-end: 1px solid var(--dashboard-sidebar-border);
  background: var(--dashboard-sidebar-bg);
  box-shadow: none;
  backdrop-filter: none;
}

.dashboard-sidebar-brand {
  --dashboard-brand-hover: var(--ui-bg-muted);
  --dashboard-brand-mark-bg: color-mix(in oklab, var(--ui-bg-elevated) 94%, transparent);
  --dashboard-brand-mark-border: color-mix(in oklab, var(--ui-border) 88%, transparent);

  display: grid;
  flex: 1;
  min-width: 0;
  width: 100%;
}

.dashboard-sidebar-brand-collapsed {
  place-items: center;
}

.dashboard-sidebar-brand .dashboard-brand-trigger {
  min-height: 3.5rem;
  justify-content: flex-start;
  gap: 0.75rem;
  padding: 0.375rem;
  border: 1px solid transparent;
  border-radius: var(--dashboard-radius-sm);
  background: transparent;
  color: var(--ui-text-highlighted);
  box-shadow: none;
}

.dashboard-sidebar-brand .dashboard-brand-trigger:hover {
  background: var(--dashboard-brand-hover);
}

.dashboard-sidebar-brand .dashboard-brand-mark {
  position: relative;
  display: grid;
  flex: none;
  width: 2.375rem;
  height: 2.375rem;
  place-items: center;
  border: 1px solid var(--dashboard-brand-mark-border);
  border-radius: var(--dashboard-radius-sm);
  background: var(--dashboard-brand-mark-bg);
  box-shadow: var(--dashboard-shadow);
  transition: border-color 160ms ease, background-color 160ms ease;
}

.dashboard-sidebar-brand .dashboard-brand-trigger:hover .dashboard-brand-mark {
  border-color: color-mix(in oklab, var(--ui-primary) 32%, var(--ui-border));
  background: color-mix(in oklab, var(--ui-primary) 5%, var(--ui-bg-elevated));
}

.dashboard-sidebar-brand .dashboard-brand-logo {
  width: 1.625rem;
  height: 1.625rem;
  object-fit: contain;
}

.dashboard-sidebar-brand .dashboard-brand-context-mark {
  position: absolute;
  right: -0.25rem;
  bottom: -0.25rem;
  display: grid;
  width: 1rem;
  height: 1rem;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: var(--ui-bg-elevated);
  color: var(--ui-primary);
  box-shadow: 0 0 0 2px var(--ui-bg);
}

.dashboard-sidebar-brand .dashboard-brand-context-icon {
  width: 0.625rem;
  height: 0.625rem;
}

.dashboard-sidebar-brand .dashboard-brand-copy {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 0.125rem;
  text-align: start;
}

.dashboard-sidebar-brand .dashboard-brand-name {
  overflow: hidden;
  font-family: var(--font-display);
  font-size: 0.9375rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  line-height: 1.125rem;
  color: var(--ui-text-highlighted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-sidebar-brand .dashboard-brand-workspace {
  display: flex;
  overflow: hidden;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
  color: var(--ui-text-toned);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-sidebar-brand .dashboard-brand-workspace-icon {
  flex: none;
  width: 0.75rem;
  height: 0.75rem;
  color: var(--ui-primary);
}

.dashboard-sidebar-nav-group {
  display: grid;
  gap: 0.375rem;
}

.dashboard-sidebar-group-label {
  padding: 0 0.75rem 0.125rem;
  font-family: var(--font-code);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
  color: var(--ui-text-muted);
  letter-spacing: 0;
  text-transform: uppercase;
}

.dashboard-sidebar-menu {
  gap: 0.25rem;
}

.dashboard-sidebar-link {
  position: relative;
  border: 0;
  color: var(--ui-text-toned);
  transition: color 160ms ease;
}

.dashboard-sidebar-link::before {
  border-radius: var(--dashboard-radius-sm);
  transition: background-color 160ms ease;
}

.dashboard-sidebar-link::after {
  position: absolute;
  z-index: 1;
  top: 50%;
  inset-inline-start: 0.25rem;
  width: 2px;
  height: 1.125rem;
  border-radius: 999px;
  background: var(--dashboard-sidebar-accent);
  content: '';
  opacity: 0;
  transform: translateY(-50%) scaleY(0.45);
  transition: opacity 160ms ease, transform 160ms ease;
}

.dashboard-sidebar-link:hover::before {
  background: var(--dashboard-sidebar-hover);
}

.dashboard-sidebar-link:hover {
  color: var(--ui-text-highlighted);
}

.dashboard-sidebar-link-icon {
  color: var(--ui-text-muted);
  transition: color 160ms ease;
}

.dashboard-sidebar-link:hover .dashboard-sidebar-link-icon {
  color: var(--ui-text);
}

.dashboard-sidebar-link[data-active] {
  color: var(--ui-text-highlighted);
  box-shadow: none;
}

.dashboard-sidebar-link[data-active]::before {
  background: var(--dashboard-sidebar-active);
}

.dashboard-sidebar-link[data-active]::after {
  opacity: 1;
  transform: translateY(-50%) scaleY(1);
}

.dashboard-sidebar-link[data-active] .dashboard-sidebar-link-icon {
  color: var(--ui-text-highlighted);
}

.dashboard-sidebar-link-label {
  letter-spacing: -0.02em;
}

.dashboard-sidebar-footer-menu {
  width: 100%;
}

.dashboard-sidebar[data-collapsed="true"] .dashboard-brand-trigger,
.dashboard-sidebar[data-collapsed="true"] .dashboard-sidebar-link {
  justify-content: center;
  padding-inline: 0.5rem;
}

.dashboard-sidebar[data-collapsed="true"] .dashboard-sidebar-link::after {
  inset-inline-start: 0.125rem;
}

:is(.dashboard-shell-refined, .dashboard-sidebar-panel) [data-slot="body"] {
  scrollbar-width: thin;
  scrollbar-color: var(--ui-border) transparent;
}

@media (width < 1024px) {
  .dashboard-sidebar-brand .dashboard-brand-trigger {
    min-height: 3rem;
    gap: 0.625rem;
    padding: 0.25rem;
  }

  .dashboard-sidebar-brand .dashboard-brand-mark {
    width: 2.125rem;
    height: 2.125rem;
    border-radius: var(--dashboard-radius-sm);
  }

  .dashboard-sidebar-brand .dashboard-brand-logo {
    width: 1.4375rem;
    height: 1.4375rem;
  }

  .dashboard-sidebar-brand .dashboard-brand-name {
    font-size: 0.875rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-sidebar-link,
  .dashboard-sidebar-link::before,
  .dashboard-sidebar-link::after,
  .dashboard-sidebar-link-icon,
  .dashboard-sidebar-brand .dashboard-brand-mark {
    transition: none;
  }
}
</style>
