<script setup lang="ts">
import { PUBLIC_STATS_DASHBOARD_CACHE_TTL_SECONDS } from '#shared/config/public-stats'
import { usePublicStatsDashboard } from '~/composables/use-public-stats-dashboard'

const { t } = useI18n()
const toast = useToast()
const REFRESH_COOLDOWN_MS = PUBLIC_STATS_DASHBOARD_CACHE_TTL_SECONDS * 1000
useHead(() => ({ title: t('public.stats.pageTitle') }))
useSeoMeta({
  description: () => t('public.stats.seoDescription'),
  ogTitle: () => t('public.stats.seoTitle'),
  ogDescription: () => t('public.stats.seoDescription')
})

definePageMeta({ layout: false })

const {
  error,
  formatCompact,
  formatCount,
  formatRate,
  generatedAtLabel,
  hasData,
  isInitialLoading,
  isPending,
  overview,
  overviewCards,
  reloadStats,
  rankingLast30d,
  topApi,
  trend7d,
  trendFailureCalls,
  trendSuccessCalls,
  trendTotalCalls
} = usePublicStatsDashboard()

const currentTime = ref(Date.now())
const refreshCooldownEndsAt = ref(0)

useIntervalFn(() => {
  currentTime.value = Date.now()
}, 1000)

const refreshCooldownSeconds = computed(() => Math.max(
  0,
  Math.ceil((refreshCooldownEndsAt.value - currentTime.value) / 1000)
))

const refreshButtonLabel = computed(() => refreshCooldownSeconds.value > 0
  ? t('public.stats.refreshCooldown', { seconds: refreshCooldownSeconds.value })
  : t('public.stats.refresh'))

const refreshDisabled = computed(() => isPending.value || refreshCooldownSeconds.value > 0)
const trendChartContainer = useTemplateRef<HTMLElement>('trendChartContainer')
const shouldLoadTrendChart = ref(false)

useIntersectionObserver(
  trendChartContainer,
  ([entry]) => {
    if (entry?.isIntersecting) shouldLoadTrendChart.value = true
  },
  { rootMargin: '240px' }
)

async function handleRefresh(): Promise<void> {
  if (refreshDisabled.value) return

  await reloadStats()
  currentTime.value = Date.now()

  if (error.value) {
    toast.add({
      title: t('public.stats.loadFailed'),
      description: t('public.stats.loadFailedDescription'),
      icon: 'i-mdi-alert-circle-outline',
      color: 'error'
    })
    return
  }

  refreshCooldownEndsAt.value = currentTime.value + REFRESH_COOLDOWN_MS
  toast.add({
    title: t('public.stats.refreshSuccess'),
    description: t('public.stats.refreshSuccessDescription', {
      seconds: PUBLIC_STATS_DASHBOARD_CACHE_TTL_SECONDS
    }),
    icon: 'i-mdi-check-circle-outline',
    color: 'success'
  })
}

const retryActions = computed(() => [{
  label: t('common.actions.retry'),
  color: 'neutral' as const,
  variant: 'outline' as const,
  icon: 'i-lucide-refresh-cw',
  onClick: reloadStats
}])
</script>

<template>
  <div class="public-page">
    <CommonSiteHeader />
    <main
      class="stats-page public-content"
      :aria-busy="isInitialLoading"
    >
      <section class="stats-hero public-page-heading">
        <div class="stats-hero__inner">
          <div class="stats-hero__layout">
            <div class="stats-hero__copy">
              <span class="public-eyebrow">{{ $t('public.stats.kicker') }}</span>
              <h1 class="stats-hero__title">
                {{ $t('public.stats.heroTitle') }}
              </h1>
              <p class="stats-hero__description">
                {{ $t('public.stats.heroDescription') }}
              </p>
              <div class="stats-hero__meta">
                <span
                  v-if="generatedAtLabel"
                  class="inline-flex items-center gap-1.5"
                >
                  <UIcon
                    name="i-mdi-clock-outline"
                    class="size-3.5"
                  />
                  <span class="font-mono text-default/85">{{ generatedAtLabel }}</span>
                </span>
                <span
                  v-else-if="isInitialLoading"
                  class="inline-flex items-center gap-1.5"
                  aria-hidden="true"
                >
                  <USkeleton class="size-3.5 rounded-full" />
                  <USkeleton class="h-3.5 w-36" />
                </span>
                <UButton
                  icon="i-lucide-refresh-cw"
                  variant="outline"
                  color="neutral"
                  size="sm"
                  class="stats-hero__refresh min-w-28 justify-center tabular-nums"
                  :loading="isPending"
                  :disabled="refreshDisabled"
                  :label="refreshButtonLabel"
                  @click="handleRefresh"
                />
              </div>
            </div>

            <div class="stats-hero__aside">
              <div class="stats-hero__stats grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-3 sm:gap-3">
                <template v-if="isInitialLoading">
                  <CommonHeroStatCard
                    v-for="n in 3"
                    :key="n"
                    loading
                  />
                </template>

                <template v-else>
                  <CommonHeroStatCard
                    icon="i-mdi-counter"
                    icon-tone="ink"
                    :value-title="overview ? formatCount(overview.totalCalls) : undefined"
                  >
                    <template #value>
                      {{ overview ? formatCompact(overview.totalCalls) : '--' }}
                    </template>
                    {{ $t('public.stats.totalCalls') }}
                  </CommonHeroStatCard>

                  <CommonHeroStatCard
                    icon="i-mdi-check-decagram-outline"
                    icon-tone="ink"
                  >
                    <template #value>
                      {{ overview ? formatRate(overview.successRate) : '--' }}
                    </template>
                    {{ $t('public.stats.successRate') }}
                  </CommonHeroStatCard>

                  <CommonHeroStatCard
                    icon="i-mdi-trophy-outline"
                    icon-tone="ink"
                    :value-title="topApi?.name"
                    :label-title="topApi?.name"
                  >
                    <template #value>
                      {{ topApi ? formatCompact(topApi.totalCalls) : '--' }}
                    </template>
                    {{ topApi?.name || $t('public.stats.popularApi') }}
                  </CommonHeroStatCard>
                </template>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div class="stats-content">
        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-mdi-alert-circle-outline"
          :title="t('public.stats.loadFailed')"
          :description="t('public.stats.loadFailedDescription')"
          class="mb-4"
          :actions="retryActions"
        />

        <StatsDashboardSkeleton
          v-if="isInitialLoading"
        />

        <template v-else-if="hasData">
          <div class="stats-metrics-grid">
            <DashboardMetricCard
              v-for="item in overviewCards"
              :key="item.key"
              :label="item.label"
              :value="item.value"
              :icon="item.icon"
              tone="ink"
              :meta="item.helper"
              compact
            />
          </div>

          <div class="stats-panels">
            <UCard
              variant="subtle"
              class="stats-panel"
              :ui="{ body: 'p-4 sm:p-6', header: 'p-4 sm:p-6' }"
            >
              <template #header>
                <div>
                  <h2 class="stats-panel__title">
                    {{ $t('public.stats.trendTitle') }}
                  </h2>
                  <p class="stats-panel__description">
                    {{ $t('public.stats.trendDescription') }}
                  </p>
                </div>
              </template>

              <dl class="stats-summary-strip mb-4">
                <div>
                  <dt>{{ $t('public.stats.trendTotal') }}</dt>
                  <dd>{{ formatCount(trendTotalCalls) }}</dd>
                </div>
                <div>
                  <dt>{{ $t('public.stats.successCalls') }}</dt>
                  <dd>{{ formatCount(trendSuccessCalls) }}</dd>
                </div>
                <div>
                  <dt>{{ $t('public.stats.failureCalls') }}</dt>
                  <dd>{{ formatCount(trendFailureCalls) }}</dd>
                </div>
              </dl>

              <div
                ref="trendChartContainer"
                class="min-h-[352px]"
              >
                <ClientOnly>
                  <Suspense v-if="shouldLoadTrendChart">
                    <LazyStatsTrendChart :trend="trend7d" />
                    <template #fallback>
                      <div class="h-[320px] w-full rounded-lg bg-elevated/50" />
                    </template>
                  </Suspense>
                  <div
                    v-else
                    class="h-[320px] w-full rounded-lg bg-elevated/50"
                  />
                  <template #fallback>
                    <div class="h-[320px] w-full rounded-lg bg-elevated/50" />
                  </template>
                </ClientOnly>
              </div>
            </UCard>

            <UCard
              variant="subtle"
              class="stats-panel"
              :ui="{ body: 'p-4 sm:p-6', header: 'p-4 sm:p-6' }"
            >
              <template #header>
                <div>
                  <h2 class="stats-panel__title">
                    {{ $t('public.stats.rankingTitle') }}
                  </h2>
                  <p class="stats-panel__description">
                    {{ $t('public.stats.rankingDescription', { count: rankingLast30d.length || 10 }) }}
                  </p>
                </div>
              </template>

              <DashboardCallRanking :ranking="rankingLast30d" />
            </UCard>
          </div>
        </template>
      </div>
    </main>
    <CommonAppFooter />
  </div>
</template>

<style scoped>
.stats-content { margin-top: 32px; }

.stats-hero__layout {
  display: grid;
  align-items: center;
  gap: 32px;
}

.stats-hero__copy,
.stats-hero__aside { min-width: 0; }

.stats-hero__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  margin-top: 24px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.stats-hero__refresh {
  min-height: 44px;
  border-radius: 6px;
  background: var(--ui-bg-elevated);
}

.stats-hero__stats :deep(.hero-stat-card) {
  gap: 8px;
  padding: 20px 16px;
  border-color: var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
}

.stats-hero__stats :deep(.hero-stat-card__icon) {
  width: 24px;
  height: 24px;
  margin-bottom: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  box-shadow: none;
}

.stats-hero__stats :deep(.hero-stat-card__value) {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.8px;
}

.stats-hero__stats :deep(.hero-stat-card__label) { font-size: 12px; }

.stats-metrics-grid {
  display: grid;
  gap: 16px;
}

.stats-metrics-grid :deep(.dashboard-metric-card) {
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  box-shadow: none;
}

.stats-metrics-grid :deep(.dashboard-metric-card__content) {
  min-height: 108px;
  padding: 24px;
}

.stats-metrics-grid :deep(.dashboard-metric-card-value) {
  margin-top: 8px;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.8px;
}

.stats-metrics-grid :deep(.dashboard-metric-card-icon) {
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  box-shadow: none;
}

.stats-metrics-grid :deep(.dashboard-metric-card__footer) {
  padding: 12px 24px;
  border-color: var(--ui-border);
  background: var(--ui-bg-elevated);
}

.stats-panels { display: grid; gap: 24px; margin-top: 24px; }

.stats-panel {
  overflow: hidden;
  border-color: var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  box-shadow: none;
}

.stats-panel__title {
  color: var(--ui-text-highlighted);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.4px;
}

.stats-panel__description { margin-top: 8px; color: var(--ui-text-muted); font-size: 14px; }

.stats-summary-strip { display: grid; }
.stats-summary-strip > div { min-width: 0; padding: 16px 0; }
.stats-summary-strip > div + div { border-top: 1px solid var(--ui-border); }
.stats-summary-strip dt { color: var(--ui-text-muted); font-size: 12px; }
.stats-summary-strip dd {
  margin-top: 8px;
  color: var(--ui-text-highlighted);
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.6px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.stats-panel :deep(.rank-header) { padding-bottom: 16px; }
.stats-panel :deep(.rank-row) { padding-block: 20px; }

@media (width >= 640px) {
  .stats-metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .stats-summary-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .stats-summary-strip > div { padding-inline: 24px; }
  .stats-summary-strip > div:first-child { padding-left: 0; }
  .stats-summary-strip > div:last-child { padding-right: 0; }
  .stats-summary-strip > div + div { border-top: 0; border-left: 1px solid var(--ui-border); }
}

@media (width >= 1024px) {
  .stats-metrics-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .stats-hero__layout { grid-template-columns: minmax(0, 1.1fr) minmax(400px, 0.9fr); gap: 48px; }
}

@media (width < 640px) {
  .stats-hero__stats :deep(.hero-stat-card) { padding: 16px 12px; }
  .stats-hero__stats :deep(.hero-stat-card__value) { font-size: 22px; }
  .stats-metrics-grid :deep(.dashboard-metric-card__content) { min-height: 100px; padding: 20px; }
  .stats-metrics-grid :deep(.dashboard-metric-card__footer) { padding-inline: 20px; }
}
</style>
