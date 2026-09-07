<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type {
  AdminDashboardData,
  AdminDashboardInsightsData,
  AdminDashboardRange,
  AdminDashboardRecentCall,
  AdminDashboardTrendPoint
} from '#shared/types/admin'
import ApiHttpMethodBadge from '~/components/api/HttpMethodBadge.vue'
import { ADMIN_APIS_PATH, ADMIN_LOGS_PATH, ADMIN_USERS_PATH } from '~/constants/dashboard-config'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import type { DashboardMetricTone } from '~/types/dashboard-metric'
import { formatCount, formatPercent } from '~/utils/number-format'

const { t, locale } = useI18n()

useHead({ title: () => t('admin.overview.pageTitle') })

type HttpStatusColor = 'success' | 'warning' | 'error' | 'neutral'

const OVERVIEW_SPARKLINE_RANGE: AdminDashboardRange = 7
const selectedTrendRange = ref<AdminDashboardRange>(OVERVIEW_SPARKLINE_RANGE)
const rangeOptions = computed<Array<{ label: string, value: AdminDashboardRange }>>(() => [
  { label: t('common.dateTime.presets.last7Days'), value: 7 },
  { label: t('common.dateTime.presets.last14Days'), value: 14 },
  { label: t('common.dateTime.presets.last30Days'), value: 30 }
])
const recentColumns = computed<TableColumn<AdminDashboardRecentCall>[]>(() => [
  { accessorKey: 'createdAt', header: t('admin.overview.recent.columns.time') },
  { accessorKey: 'method', header: t('admin.overview.recent.columns.method') },
  { accessorKey: 'apiName', header: 'API' },
  { accessorKey: 'statusCode', header: t('admin.overview.recent.columns.status') },
  { accessorKey: 'latencyMs', header: t('admin.overview.recent.columns.latency') }
])

function createEmptyDashboardData(): AdminDashboardData {
  return {
    overview: {
      userCount: 0,
      enabledApiCount: 0,
      totalApiCount: 0,
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      successRate: 0,
      todayCalls: 0,
      yesterdayCalls: 0,
      todayChangeRate: 0
    },
    trend: [],
    distribution: [],
    recentCalls: [],
    generatedAt: new Date(0).toISOString()
  }
}

function createEmptyDashboardInsightsData(): AdminDashboardInsightsData {
  return {
    hourlyTrend24h: []
  }
}

const { data, loading } = usePrivateResource<AdminDashboardData>({
  path: '/api/admin/dashboard',
  query: { days: OVERVIEW_SPARKLINE_RANGE, top: 5 },
  defaultData: createEmptyDashboardData
})
const {
  data: trendData,
  loading: trendLoading,
  refresh: refreshTrend
} = usePrivateResource<AdminDashboardData>({
  path: '/api/admin/dashboard',
  query: computed(() => ({ days: selectedTrendRange.value, top: 1, recent: 1 })),
  immediate: false,
  defaultData: createEmptyDashboardData
})
const {
  data: insightsData,
  loading: insightsLoading,
  refresh: refreshInsights
} = usePrivateResource<AdminDashboardInsightsData>({
  path: '/api/admin/dashboard/insights',
  defaultData: createEmptyDashboardInsightsData
})
const overview = computed(() => data.value.overview)
const overviewTrend = computed(() => data.value.trend)
const isUsingOverviewTrend = computed(() => selectedTrendRange.value === OVERVIEW_SPARKLINE_RANGE)
const chartTrend = computed(() => isUsingOverviewTrend.value ? data.value.trend : trendData.value.trend)
const chartLoading = computed(() => isUsingOverviewTrend.value ? loading.value : trendLoading.value)
const distribution = computed(() => data.value.distribution)
const hourlyTrend24h = computed(() => insightsData.value.hourlyTrend24h)

useIntervalFn(() => {
  if (!insightsLoading.value) void refreshInsights()
}, 60_000)

const recentCalls = computed(() => data.value.recentCalls)
const generatedAt = computed(() => formatDateTime(data.value.generatedAt, '-', locale.value))
const callsTrendValues = computed(() => getCallsTrendValues(overviewTrend.value))
const successRateTrendValues = computed(() => getSuccessRateTrendValues(overviewTrend.value))

watch(selectedTrendRange, () => {
  if (isUsingOverviewTrend.value) return
  void refreshTrend()
})

interface OverviewMetricCard {
  key: string
  label: string
  value: string
  unit?: string
  meta?: string
  icon: string
  tone: DashboardMetricTone
  sparklineValues?: number[]
}

const overviewMetricCards = computed<OverviewMetricCard[]>(function getOverviewMetricCards() {
  return [
    {
      key: 'users',
      label: t('admin.overview.metrics.users'),
      value: formatCount(overview.value.userCount, locale.value),
      unit: t('admin.units.people'),
      meta: t('admin.overview.metrics.usersDescription'),
      icon: 'i-mdi-account-group-outline',
      tone: 'ink'
    },
    {
      key: 'apis',
      label: t('admin.overview.metrics.enabledApis'),
      value: formatCount(overview.value.enabledApiCount, locale.value),
      unit: t('admin.units.items'),
      meta: t('admin.overview.metrics.totalApis', { count: formatCount(overview.value.totalApiCount, locale.value) }),
      icon: 'i-mdi-api',
      tone: 'violet'
    },
    {
      key: 'calls',
      label: t('admin.overview.metrics.totalCalls'),
      value: formatCount(overview.value.totalCalls, locale.value),
      unit: t('common.units.times'),
      icon: 'i-mdi-chart-line',
      tone: 'blue',
      sparklineValues: callsTrendValues.value
    },
    {
      key: 'success-rate',
      label: t('admin.overview.metrics.successRate'),
      value: formatPercent(overview.value.successRate),
      icon: 'i-mdi-shield-check-outline',
      tone: 'blue',
      sparklineValues: successRateTrendValues.value
    }
  ]
})

function getCallsTrendValues(trendItems: AdminDashboardTrendPoint[]): number[] {
  return trendItems.map(point => point.totalCalls)
}

function getSuccessRateTrendValues(trendItems: AdminDashboardTrendPoint[]): number[] {
  return trendItems.map(point => (point.totalCalls > 0 ? (point.successCalls / point.totalCalls) * 100 : 0))
}

function httpStatusColor(code: number): HttpStatusColor {
  if (code >= 500) return 'error'
  if (code >= 400) return 'warning'
  if (code >= 200 && code < 300) return 'success'
  return 'neutral'
}

function recentStatusColor(row: AdminDashboardRecentCall): HttpStatusColor {
  if (!row.isCounted) return 'neutral'
  if (row.errorCode) return 'error'
  return httpStatusColor(row.statusCode)
}
</script>

<template>
  <UDashboardPanel id="admin-home">
    <template #header>
      <DashboardPageNavbar :title="$t('admin.overview.title')" />
    </template>

    <template #body>
      <div class="dashboard-section-page space-y-6">
        <DashboardOverviewHero
          :title="$t('admin.overview.hero.title')"
          :description="$t('admin.overview.hero.description')"
        >
          <template #actions>
            <UButton
              :to="ADMIN_USERS_PATH"
              color="neutral"
              size="md"
              icon="i-mdi-account-group-outline"
            >
              {{ $t('common.dashboard.navigation.userManagement') }}
            </UButton>
            <UButton
              :to="ADMIN_APIS_PATH"
              color="neutral"
              variant="outline"
              size="md"
              icon="i-mdi-api"
            >
              {{ $t('common.dashboard.navigation.apiManagement') }}
            </UButton>
          </template>

          <div class="flex h-full flex-col gap-4 rounded-lg border border-default bg-elevated p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-mdi-pulse"
                  class="size-4 text-muted"
                />
                <span class="text-sm font-medium">{{ $t('admin.overview.snapshot.title') }}</span>
              </div>
              <span class="text-[11px] text-muted tabular-nums">{{ generatedAt }}</span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1">
                <div class="text-xs text-muted">
                  {{ $t('admin.overview.snapshot.todayCalls') }}
                </div>
                <div class="text-xl font-semibold tabular-nums">
                  {{ formatCount(overview.todayCalls, locale) }}
                </div>
              </div>
              <div class="space-y-1">
                <div class="text-xs text-muted">
                  {{ $t('admin.overview.metrics.successRate') }}
                </div>
                <div class="text-xl font-semibold tabular-nums">
                  {{ formatPercent(overview.successRate) }}
                </div>
              </div>
            </div>

            <div class="mt-auto border-t border-default pt-3">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted">{{ $t('admin.overview.snapshot.comparedYesterday') }}</span>
                <span
                  :class="overview.todayChangeRate >= 0 ? 'text-success' : 'text-error'"
                  class="inline-flex items-center gap-1 font-medium"
                >
                  <UIcon
                    :name="overview.todayChangeRate >= 0 ? 'i-mdi-trending-up' : 'i-mdi-trending-down'"
                    class="size-3.5"
                  />
                  {{ overview.todayChangeRate >= 0 ? '+' : '' }}{{ overview.todayChangeRate.toFixed(1) }}%
                </span>
              </div>
            </div>
          </div>
        </DashboardOverviewHero>

        <!-- 平台概览 -->
        <section class="space-y-4">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 class="text-lg font-semibold text-highlighted">
                {{ $t('admin.overview.platformTitle') }}
              </h3>
            </div>
            <UButton
              :to="ADMIN_LOGS_PATH"
              size="xs"
              color="neutral"
              variant="ghost"
              trailing-icon="i-mdi-chevron-right"
            >
              {{ $t('admin.overview.actions.viewCallLogs') }}
            </UButton>
          </div>

          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <DashboardMetricCard
              v-for="card in overviewMetricCards"
              :key="card.key"
              :label="card.label"
              :value="card.value"
              :unit="card.unit"
              :meta="card.meta"
              :icon="card.icon"
              :tone="card.tone"
              :sparkline-values="card.sparklineValues"
              compact
            />
          </div>
        </section>

        <div class="grid gap-4 xl:grid-cols-5">
          <DashboardContentCard
            class="xl:col-span-3"
            :title="$t('admin.overview.trend.title')"
            :description="$t('admin.overview.trend.description')"
            icon="i-mdi-chart-line"
          >
            <template #actions>
              <USelect
                v-model="selectedTrendRange"
                :items="rangeOptions"
                value-key="value"
                size="sm"
                class="w-32"
              />
            </template>

            <AdminDashboardTrend
              :trend="chartTrend"
              :loading="chartLoading"
            />
          </DashboardContentCard>

          <DashboardContentCard
            class="xl:col-span-2"
            :title="$t('admin.overview.distribution.title')"
            :description="$t('admin.overview.distribution.description')"
            icon="i-mdi-chart-donut"
          >
            <AdminDashboardDistribution
              :distribution="distribution"
              :loading="loading"
            />
          </DashboardContentCard>
        </div>

        <DashboardContentCard
          :title="$t('admin.overview.hourly.title')"
          :description="$t('admin.overview.hourly.description')"
          icon="i-mdi-clock-outline"
        >
          <div
            v-if="insightsLoading && !hourlyTrend24h.length"
            class="h-64 w-full animate-pulse rounded-lg bg-elevated/50"
          />
          <ClientOnly v-else>
            <Suspense>
              <LazyAdminDashboardHourlyTrend :trend="hourlyTrend24h" />
              <template #fallback>
                <div class="h-64 w-full animate-pulse rounded-lg bg-elevated/50" />
              </template>
            </Suspense>
            <template #fallback>
              <div class="h-64 w-full animate-pulse rounded-lg bg-elevated/50" />
            </template>
          </ClientOnly>
        </DashboardContentCard>

        <DashboardTableCard
          :title="$t('admin.overview.recent.title')"
          icon="i-mdi-history"
          :total="recentCalls.length"
        >
          <template #actions>
            <UButton
              :to="ADMIN_LOGS_PATH"
              variant="link"
              size="sm"
              trailing-icon="i-mdi-arrow-right"
            >
              {{ $t('admin.overview.actions.viewFullLogs') }}
            </UButton>
          </template>

          <DashboardDataTable
            :data="recentCalls"
            :columns="recentColumns"
            :loading="loading && recentCalls.length === 0"
            :empty-title="$t('admin.overview.recent.empty')"
            empty-icon="i-mdi-history"
          >
            <template #createdAt-cell="{ row }">
              <span class="whitespace-nowrap text-xs tabular-nums text-muted">
                {{ formatDateTime(row.original.createdAt, '-', locale) }}
              </span>
            </template>
            <template #method-cell="{ row }">
              <ApiHttpMethodBadge :method="row.original.method" />
            </template>
            <template #apiName-cell="{ row }">
              <div class="min-w-0">
                <div class="truncate text-sm font-medium">
                  {{ row.original.apiName }}
                </div>
                <div class="truncate text-xs font-mono text-muted">
                  {{ row.original.apiPath }}
                </div>
              </div>
            </template>
            <template #statusCode-cell="{ row }">
              <UBadge
                :color="recentStatusColor(row.original)"
                variant="subtle"
                size="sm"
              >
                {{ row.original.statusCode }}
              </UBadge>
            </template>
            <template #latencyMs-cell="{ row }">
              <span class="whitespace-nowrap tabular-nums text-xs">{{ $t('admin.overview.recent.milliseconds', { value: row.original.latencyMs.toLocaleString(locale) }) }}</span>
            </template>
          </DashboardDataTable>
        </DashboardTableCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
