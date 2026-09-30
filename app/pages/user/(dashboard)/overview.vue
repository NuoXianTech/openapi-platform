<script setup lang="ts">
import type { UserDashboardData } from '#shared/types/user-dashboard'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import type { DashboardMetricTone } from '~/types/dashboard-metric'

const { t, locale } = useI18n()

useHead({ title: () => t('user.overview.pageTitle') })

const toast = useToast()
const { copyText } = useCopyFeedback()

const requestURL = useRequestURL()
const origin = requestURL.origin || ''

function createEmptyUserDashboardData(): UserDashboardData {
  return {
    credits: { balance: 0, totalSpent: 0, spent24h: 0 },
    calls: { total: 0, success: 0, failure: 0, successRate: 0, requests24h: 0 },
    apiKeys: { total: 0, active: 0 },
    trend: [],
    hourlyTrend24h: [],
    generatedAt: new Date(0).toISOString()
  }
}

const { data, error } = usePrivateResource<UserDashboardData>({
  path: '/api/user/dashboard',
  defaultData: createEmptyUserDashboardData
})

watch(error, (err) => {
  if (err) {
    toast.add({ title: t('user.overview.loadFailed'), color: 'error' })
  }
})

const credits = computed(() => data.value.credits)
const calls = computed(() => data.value.calls)
const apiKeys = computed(() => data.value.apiKeys)
const trend = computed(() => data.value.trend)
const hourlyTrend24h = computed(() => data.value.hourlyTrend24h)
const callsTrendValues = computed(() => trend.value.map(point => point.totalCalls))
const spendTrendValues = computed(() => trend.value.map(point => point.creditsSpent))
const hasKeys = computed(() => apiKeys.value.total > 0)
const sampleCurl = computed(() => [
  `curl -X GET '${origin}/v1/your-endpoint' \\`,
  `  -H 'x-api-key: <your-api-key>'`
].join('\n'))

interface UserOverviewMetricAction {
  label: string
  to: string
  icon: string
}

interface UserOverviewMetricCard {
  key: string
  label: string
  value: string
  unit?: string
  icon: string
  tone: DashboardMetricTone
  sparklineValues?: number[]
  action?: UserOverviewMetricAction
}

const overviewMetricCards = computed<UserOverviewMetricCard[]>(function getUserOverviewMetricCards() {
  return [
    {
      key: 'spent24h',
      label: t('user.overview.metrics.spent24h'),
      value: credits.value.spent24h.toLocaleString(locale.value),
      unit: t('common.units.points'),
      icon: 'i-mdi-fire',
      tone: 'bronze',
      sparklineValues: spendTrendValues.value
    },
    {
      key: 'totalSpent',
      label: t('user.overview.metrics.totalSpent'),
      value: credits.value.totalSpent.toLocaleString(locale.value),
      unit: t('common.units.points'),
      icon: 'i-mdi-chart-line',
      tone: 'violet',
      sparklineValues: spendTrendValues.value
    },
    {
      key: 'totalCalls',
      label: t('user.overview.metrics.totalCalls'),
      value: calls.value.total.toLocaleString(locale.value),
      unit: t('common.units.times'),
      icon: 'i-mdi-heart-pulse',
      tone: 'blue',
      sparklineValues: callsTrendValues.value
    },
    {
      key: 'balance',
      label: t('user.overview.metrics.balance'),
      value: credits.value.balance.toLocaleString(locale.value),
      unit: t('common.units.points'),
      icon: 'i-mdi-cash-multiple',
      tone: 'ink',
      action: { label: t('user.overview.actions.viewCredits'), to: '/user/credits', icon: 'i-mdi-arrow-right' }
    }
  ]
})

async function copyCurl() {
  await copyText(sampleCurl.value, {
    successTitle: t('user.overview.copySuccess'),
    errorTitle: t('user.overview.copyFailed')
  })
}
</script>

<template>
  <UDashboardPanel id="user-overview">
    <template #header>
      <DashboardPageNavbar :title="$t('user.overview.title')" />
    </template>

    <template #body>
      <div class="dashboard-section-page space-y-6">
        <DashboardOverviewHero
          :title="$t('user.overview.hero.title')"
          :description="$t('user.overview.hero.description')"
        >
          <template #actions>
            <UButton
              to="/user/apikeys"
              color="neutral"
              size="md"
              icon="i-mdi-key-plus"
            >
              {{ $t('user.overview.actions.createApiKey') }}
            </UButton>
            <UButton
              to="/user/credits"
              color="neutral"
              variant="outline"
              size="md"
              icon="i-mdi-cash-multiple"
            >
              {{ $t('user.overview.actions.manageCredits') }}
            </UButton>
          </template>

          <div class="flex h-full flex-col gap-4 rounded-xl border border-default bg-elevated p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-mdi-console-line"
                  class="size-4 text-muted"
                />
                <span class="text-sm font-medium">{{ $t('user.overview.firstRequest.title') }}</span>
              </div>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-mdi-content-copy"
                @click="copyCurl"
              >
                {{ $t('common.actions.copy') }}
              </UButton>
            </div>
            <pre class="overflow-x-auto rounded-md border border-default bg-default p-4 font-mono text-sm leading-5 text-toned"><code>{{ sampleCurl }}</code></pre>

            <div class="mt-auto space-y-2.5 border-t border-default pt-3">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted">{{ $t('user.apiKeys.title') }}</span>
                <span
                  v-if="hasKeys"
                  class="inline-flex items-center gap-1.5 text-success font-medium"
                >
                  <span class="size-1.5 rounded-full bg-success" />
                  {{ $t('user.overview.firstRequest.ready') }}
                </span>
                <span
                  v-else
                  class="inline-flex items-center gap-1.5 text-warning font-medium"
                >
                  <span class="size-1.5 rounded-full bg-warning" />
                  {{ $t('user.overview.firstRequest.notCreated') }}
                </span>
              </div>
            </div>
          </div>
        </DashboardOverviewHero>

        <!-- Usage Overview -->
        <section class="space-y-4">
          <div class="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 class="text-lg font-semibold text-highlighted">
                {{ $t('user.overview.usage.title') }}
              </h3>
              <p class="text-sm text-muted">
                {{ $t('user.overview.usage.description') }}
              </p>
            </div>
            <UButton
              to="/user/logs"
              size="xs"
              color="neutral"
              variant="ghost"
              trailing-icon="i-mdi-chevron-right"
            >
              {{ $t('user.overview.actions.viewLogs') }}
            </UButton>
          </div>

          <div class="grid gap-3 lg:grid-cols-4">
            <DashboardMetricCard
              v-for="card in overviewMetricCards"
              :key="card.key"
              class="lg:col-span-1"
              :label="card.label"
              :value="card.value"
              :unit="card.unit"
              :icon="card.icon"
              :tone="card.tone"
              :sparkline-values="card.sparklineValues"
            >
              <template
                v-if="card.action"
                #footer
              >
                <UButton
                  :to="card.action.to"
                  block
                  color="neutral"
                  :trailing-icon="card.action.icon"
                >
                  {{ card.action.label }}
                </UButton>
              </template>
            </DashboardMetricCard>
          </div>
        </section>

        <section>
          <DashboardContentCard
            :title="$t('user.overview.chart.title')"
            :description="$t('user.overview.chart.description')"
            icon="i-mdi-chart-areaspline"
            body-class="p-4 sm:p-6"
          >
            <template #actions>
              <div class="flex items-center gap-4 text-xs text-muted" :aria-label="$t('user.overview.chart.legend')">
                <span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full bg-success" />{{ $t('common.states.success') }}</span>
                <span class="inline-flex items-center gap-1.5"><span class="size-2 rounded-full bg-error" />{{ $t('common.states.failure') }}</span>
              </div>
            </template>

            <Suspense>
              <UserApiRequestsHourlyChart :trend="hourlyTrend24h" />
              <template #fallback>
                <USkeleton class="h-64 w-full" />
              </template>
            </Suspense>
          </DashboardContentCard>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
