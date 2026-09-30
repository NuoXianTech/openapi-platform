<script setup lang="ts">
interface DashboardContentCardProps {
  title: string
  description?: string
  icon?: string
  bodyClass?: string
}

withDefaults(defineProps<DashboardContentCardProps>(), {
  description: undefined,
  icon: undefined,
  bodyClass: 'p-4 sm:p-6'
})

defineOptions({ inheritAttrs: false })
</script>

<template>
  <UCard
    v-bind="$attrs"
    class="dashboard-content-card"
    variant="subtle"
    :ui="{
      root: 'divide-y-0',
      header: 'dashboard-content-card-header',
      body: ['dashboard-content-card-body', bodyClass],
      footer: 'dashboard-content-card-footer'
    }"
  >
    <template #header>
      <slot name="header">
        <div class="flex min-w-0 items-center gap-2.5">
          <span
            v-if="icon"
            class="dashboard-content-card-icon"
          >
            <UIcon
              :name="icon"
              class="size-4.5"
            />
          </span>

          <div class="min-w-0">
            <h3 class="text-base font-semibold leading-6 text-highlighted">
              {{ title }}
            </h3>
            <p
              v-if="description"
              class="mt-1 text-sm leading-5 text-muted"
            >
              {{ description }}
            </p>
          </div>
        </div>

        <div
          v-if="$slots.actions"
          class="dashboard-content-card-actions"
        >
          <slot name="actions" />
        </div>
      </slot>
    </template>

    <slot />

    <template
      v-if="$slots.footer"
      #footer
    >
      <slot name="footer" />
    </template>
  </UCard>
</template>

<style scoped>
.dashboard-content-card {
  overflow: hidden;
  border-color: var(--dashboard-border);
  border-radius: var(--dashboard-radius);
  background: var(--dashboard-surface);
  box-shadow: var(--dashboard-shadow);
}

.dashboard-content-card :deep(.dashboard-content-card-header) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem;
  border-bottom: 1px solid var(--dashboard-border);
  background: var(--dashboard-surface);
}

.dashboard-content-card :deep(.dashboard-content-card-icon) {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: none;
  place-items: center;
  border: 1px solid var(--dashboard-border);
  border-radius: var(--dashboard-radius-sm);
  background: var(--dashboard-surface-muted);
  color: var(--ui-text-toned);
}

.dashboard-content-card :deep(.dashboard-content-card-actions) {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.dashboard-content-card :deep(.dashboard-content-card-body) {
  background: var(--dashboard-surface);
}

.dashboard-content-card :deep(.dashboard-content-card-footer) {
  border-top: 1px solid var(--dashboard-border);
  background: var(--dashboard-surface-muted);
}

@media (width >= 640px) {
  .dashboard-content-card :deep(.dashboard-content-card-header) {
    padding-inline: 1.5rem;
  }
}
</style>
