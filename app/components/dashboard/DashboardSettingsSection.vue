<script setup lang="ts">
interface DashboardSettingsSectionProps {
  title: string
  description?: string
}

defineProps<DashboardSettingsSectionProps>()
</script>

<template>
  <section class="dashboard-settings-section">
    <UCard
      class="dashboard-settings-section-card"
      variant="subtle"
      :ui="{
        header: 'dashboard-settings-section-header',
        body: 'dashboard-settings-section-body p-0 sm:p-0',
        footer: 'dashboard-settings-section-footer p-0 sm:p-0'
      }"
    >
      <template #header>
        <div class="min-w-0">
          <h2 class="text-base font-semibold leading-6 text-highlighted">
            {{ title }}
          </h2>
          <p
            v-if="description"
            class="mt-1 max-w-2xl text-sm text-muted"
          >
            {{ description }}
          </p>
        </div>

        <div
          v-if="$slots.actions"
          class="dashboard-settings-section-actions"
        >
          <slot name="actions" />
        </div>
      </template>

      <slot />

      <template
        v-if="$slots.footer"
        #footer
      >
        <div class="dashboard-settings-section-footer-content">
          <slot name="footer" />
        </div>
      </template>
    </UCard>
  </section>
</template>

<style scoped>
.dashboard-settings-section {
  min-width: 0;
}

.dashboard-settings-section-card {
  overflow: hidden;
  border-color: var(--dashboard-border);
  border-radius: var(--dashboard-radius);
  background: var(--dashboard-surface);
  box-shadow: var(--dashboard-shadow);
}

.dashboard-settings-section-card :deep(.dashboard-settings-section-header) {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 1rem;
  background: var(--dashboard-surface);
}

.dashboard-settings-section-card :deep(.dashboard-settings-section-actions) {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
}

.dashboard-settings-section-card :deep(.dashboard-settings-section-body) {
  background: var(--dashboard-surface);
}

.dashboard-settings-section-card :deep(.dashboard-settings-section-body > :where(:not([role="separator"]))) {
  padding: 1rem;
}

.dashboard-settings-section-card :deep(.dashboard-settings-section-body > :where(:not([role="separator"])) + :where(:not([role="separator"]))) {
  border-top: 1px solid var(--dashboard-border);
}

.dashboard-settings-section-card :deep(.dashboard-settings-section-footer) {
  background: var(--dashboard-surface-muted);
}

.dashboard-settings-section-footer-content {
  display: flex;
  width: 100%;
  min-height: 3.125rem;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem;
}

@media (width >= 640px) {
  .dashboard-settings-section-card :deep(.dashboard-settings-section-header) {
    padding: 1.25rem 1.5rem;
  }

  .dashboard-settings-section-card :deep(.dashboard-settings-section-body > :where(:not([role="separator"]))) {
    padding: 1.5rem;
  }

  .dashboard-settings-section-footer-content {
    padding-inline: 1.5rem;
  }
}

@media (width < 640px) {
  .dashboard-settings-section-footer-content {
    padding: 1rem;
  }

  .dashboard-settings-section-footer-content :deep(button) {
    width: 100%;
    justify-content: center;
  }
}
</style>
