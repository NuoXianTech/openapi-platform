<script setup lang="ts">
const GITHUB_REPOSITORY_URL = 'https://github.com/NuoXianTech/openapi-platform'

const { t } = useI18n()
const runtimeConfig = useRuntimeConfig()
const appVersion = String(runtimeConfig.public.appVersion)

useHead({ title: () => t('admin.system.about.pageTitle') })

const projectFactKeys = ['applicationType', 'managementModel', 'runtime', 'license'] as const
const capabilityItems = [
  { key: 'accounts', icon: 'i-mdi-account-key-outline' },
  { key: 'apis', icon: 'i-mdi-api' },
  { key: 'audit', icon: 'i-mdi-text-box-search-outline' },
  { key: 'operations', icon: 'i-mdi-bullhorn-outline' },
  { key: 'configuration', icon: 'i-mdi-tune-variant' }
] as const
const stackItemKeys = ['nuxt', 'ui', 'nitro', 'database', 'tooling'] as const
</script>

<template>
  <div class="dashboard-settings-page">
    <UCard
      class="about-project-card"
      variant="subtle"
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <section class="about-project">
        <div class="about-project-intro">
          <div class="about-project-identity">
            <div
              class="about-project-mark"
              aria-hidden="true"
            >
              <UIcon
                name="i-mdi-api"
                class="size-8"
              />
            </div>

            <div class="min-w-0">
              <p class="text-xs font-semibold tracking-wide text-primary uppercase">
                {{ t('admin.system.about.project.eyebrow') }}
              </p>
              <div class="mt-1.5 flex flex-wrap items-center gap-2.5">
                <h2 class="font-display text-2xl font-semibold tracking-tight text-highlighted sm:text-3xl">
                  OpenAPI
                </h2>
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  :aria-label="t('admin.system.about.project.version', { version: appVersion })"
                >
                  v{{ appVersion }}
                </UBadge>
              </div>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
                {{ t('admin.system.about.project.description') }}
              </p>
            </div>
          </div>

          <UButton
            :to="GITHUB_REPOSITORY_URL"
            class="about-github-button"
            external
            target="_blank"
            rel="noopener noreferrer"
            icon="i-mdi-github"
            trailing-icon="i-mdi-open-in-new"
            color="primary"
            size="md"
            :aria-label="t('admin.system.about.project.githubAriaLabel')"
          >
            {{ t('admin.system.about.project.github') }}
          </UButton>
        </div>

        <dl class="about-project-facts">
          <div
            v-for="factKey in projectFactKeys"
            :key="factKey"
            class="min-w-0"
          >
            <dt class="text-xs font-medium text-muted">
              {{ t(`admin.system.about.project.items.${factKey}.label`) }}
            </dt>
            <dd class="mt-1 text-sm font-semibold text-highlighted">
              {{ t(`admin.system.about.project.items.${factKey}.value`) }}
            </dd>
          </div>
        </dl>
      </section>
    </UCard>

    <div class="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.85fr)]">
      <DashboardSettingsSection
        class="about-section"
        :title="t('admin.system.about.capabilities.title')"
        :description="t('admin.system.about.capabilities.description')"
      >
        <div class="divide-y divide-default">
          <div
            v-for="item in capabilityItems"
            :key="item.key"
            class="flex gap-3.5 py-4 first:pt-0 last:pb-0"
          >
            <span class="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
              <UIcon
                :name="item.icon"
                class="size-4.5"
              />
            </span>
            <div class="min-w-0">
              <h3 class="text-sm font-semibold text-highlighted">
                {{ t(`admin.system.about.capabilities.items.${item.key}.label`) }}
              </h3>
              <p class="mt-1 text-sm leading-5 text-muted">
                {{ t(`admin.system.about.capabilities.items.${item.key}.description`) }}
              </p>
            </div>
          </div>
        </div>
      </DashboardSettingsSection>

      <DashboardSettingsSection
        class="about-section"
        :title="t('admin.system.about.stack.title')"
        :description="t('admin.system.about.stack.description')"
      >
        <div class="divide-y divide-default">
          <div
            v-for="itemKey in stackItemKeys"
            :key="itemKey"
            class="py-4 first:pt-0 last:pb-0"
          >
            <div class="flex items-center gap-2">
              <span class="size-1.5 shrink-0 rounded-full bg-primary" />
              <h3 class="text-sm font-semibold text-highlighted">
                {{ t(`admin.system.about.stack.items.${itemKey}.label`) }}
              </h3>
            </div>
            <p class="mt-1.5 ps-3.5 text-sm leading-5 text-muted">
              {{ t(`admin.system.about.stack.items.${itemKey}.description`) }}
            </p>
          </div>
        </div>
      </DashboardSettingsSection>
    </div>
  </div>
</template>

<style scoped>
.about-project-card {
  overflow: hidden;
  border-color: var(--dashboard-border);
  border-radius: var(--dashboard-radius);
  background: var(--dashboard-surface);
  box-shadow: var(--dashboard-shadow);
}

.about-project {
  padding: 1rem;
  background: var(--dashboard-surface);
}

.about-project-intro {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem 1.5rem;
}

.about-project-identity {
  display: flex;
  min-width: 0;
  flex: 1 1 32rem;
  align-items: center;
  gap: 1rem;
}

.about-project-mark {
  position: relative;
  display: grid;
  width: 4rem;
  height: 4rem;
  flex: none;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--dashboard-border);
  border-radius: var(--dashboard-radius);
  background: var(--dashboard-surface-muted);
  color: var(--ui-primary);
  box-shadow: none;
}

.about-project-mark::after {
  position: absolute;
  right: 0.55rem;
  bottom: 0.55rem;
  width: 0.45rem;
  height: 0.45rem;
  border: 2px solid var(--dashboard-surface);
  border-radius: 999px;
  background: var(--ui-success);
  content: '';
}

.about-project-facts {
  display: grid;
  gap: 1rem 1.5rem;
  margin-top: 1.125rem;
  padding-top: 1rem;
  border-top: 1px solid var(--dashboard-border);
  grid-template-columns: minmax(0, 1fr);
}

.about-section {
  height: 100%;
}

.about-section :deep(.dashboard-settings-section-card) {
  height: 100%;
}

@media (width >= 480px) {
  .about-project-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (width >= 640px) {
  .about-project {
    padding: 1.5rem;
  }

  .about-project-facts {
    margin-top: 1.375rem;
    padding-top: 1.125rem;
  }
}

@media (width >= 1280px) {
  .about-project-facts {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (width < 640px) {
  .about-project-identity {
    align-items: flex-start;
  }

  .about-project-mark {
    width: 3.25rem;
    height: 3.25rem;
    border-radius: 0.875rem;
  }

  .about-github-button {
    width: 100%;
    justify-content: center;
  }
}
</style>
