import type { PublicCallStatsDashboard } from '#shared/types/public-stats'
import type { DashboardMetricTone } from '~/types/dashboard-metric'
import { formatCompactCount, formatCount as formatLocalizedCount, formatPercent } from '~/utils/number-format'

interface PublicStatsOverviewCard {
  key: string
  label: string
  value: string
  helper: string
  icon: string
  tone: DashboardMetricTone
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function roundPercent(value: number): number {
  return Number(value.toFixed(2))
}

export function usePublicStatsDashboard() {
  const { t, locale } = useI18n()
  const formatCount = (value: number) => formatLocalizedCount(value, locale.value)
  const formatCompact = (value: number) => formatCompactCount(value, locale.value)
  const {
    data: requestData,
    pending: isPending,
    error,
    refresh
  } = useFetch<PublicCallStatsDashboard>('/api/stats/public', {
    key: 'public-stats-dashboard'
  })
  const data = computed<PublicCallStatsDashboard | null>(() => requestData.value ?? null)
  const overview = computed(() => data.value?.overview ?? null)
  const trend7d = computed(() => data.value?.trend7d ?? [])
  const rankingLast30d = computed(() => data.value?.rankingLast30d ?? [])
  const hasData = computed(() => data.value !== null)
  const isInitialLoading = computed(() => isPending.value && !hasData.value)

  const generatedAtLabel = computed(() => {
    if (!data.value?.generatedAt) return ''
    const date = new Date(data.value.generatedAt)
    return Number.isNaN(date.getTime())
      ? ''
      : date.toLocaleString(locale.value, { hour12: false })
  })

  const todayDelta = computed(() => {
    if (!overview.value) return 0
    return overview.value.todayCalls - overview.value.yesterdayCalls
  })

  const todayDeltaLabel = computed(() => {
    if (!overview.value) return t('public.stats.waitingSync')
    if (todayDelta.value === 0) return t('public.stats.sameAsYesterday')
    const prefix = todayDelta.value > 0 ? '+' : ''
    return t('public.stats.comparedYesterday', { value: `${prefix}${formatCount(todayDelta.value)}` })
  })

  const failureRate = computed(() => {
    const total = overview.value?.totalCalls ?? 0
    if (total <= 0) return 0
    return roundPercent(clampPercent(((overview.value?.failureCalls ?? 0) / total) * 100))
  })
  const trackedApiRatio = computed(() => {
    if (!overview.value?.trackedApiCount) return 0
    return roundPercent(clampPercent(
      (overview.value.enabledTrackedApiCount / overview.value.trackedApiCount) * 100
    ))
  })

  const trackedApiRatioLabel = computed(() => {
    if (!overview.value?.trackedApiCount) return t('public.stats.noTrackedApis')
    return t('public.stats.enabledRatio', { value: formatPercent(trackedApiRatio.value) })
  })

  const trendTotalCalls = computed(() => trend7d.value.reduce((sum, item) => sum + item.totalCalls, 0))
  const trendSuccessCalls = computed(() => trend7d.value.reduce((sum, item) => sum + item.successCalls, 0))
  const trendFailureCalls = computed(() => trend7d.value.reduce((sum, item) => sum + item.failureCalls, 0))
  const topApi = computed(() => rankingLast30d.value[0] ?? null)

  const overviewCards = computed<PublicStatsOverviewCard[]>(() => {
    if (!overview.value) return []

    return [
      {
        key: 'total',
        label: t('public.stats.totalCalls'),
        value: formatCount(overview.value.totalCalls),
        helper: t('public.stats.cards.totalHelper'),
        icon: 'i-mdi-counter',
        tone: 'ink'
      },
      {
        key: 'today',
        label: t('public.stats.cards.today'),
        value: formatCount(overview.value.todayCalls),
        helper: todayDeltaLabel.value,
        icon: 'i-mdi-calendar-today-outline',
        tone: 'blue'
      },
      {
        key: 'yesterday',
        label: t('public.stats.cards.yesterday'),
        value: formatCount(overview.value.yesterdayCalls),
        helper: t('public.stats.cards.yesterdayHelper'),
        icon: 'i-mdi-calendar-arrow-left',
        tone: 'violet'
      },
      {
        key: 'successRate',
        label: t('public.stats.successRate'),
        value: formatPercent(overview.value.successRate),
        helper: t('public.stats.cards.failureRate', { value: formatPercent(failureRate.value) }),
        icon: 'i-mdi-chart-donut',
        tone: 'blue'
      },
      {
        key: 'success',
        label: t('public.stats.successCalls'),
        value: formatCount(overview.value.successCalls),
        helper: t('public.stats.cards.successHelper'),
        icon: 'i-mdi-check-circle-outline',
        tone: 'blue'
      },
      {
        key: 'failure',
        label: t('public.stats.failureCalls'),
        value: formatCount(overview.value.failureCalls),
        helper: overview.value.failureCalls > 0
          ? t('public.stats.cards.failureAttention')
          : t('public.stats.cards.noFailures'),
        icon: 'i-mdi-close-circle-outline',
        tone: overview.value.failureCalls > 0 ? 'rose' : 'ink'
      },
      {
        key: 'users',
        label: t('public.stats.cards.users'),
        value: formatCount(overview.value.userCount),
        helper: t('public.stats.cards.usersHelper'),
        icon: 'i-mdi-account-group-outline',
        tone: 'ink'
      },
      {
        key: 'enabledStatsApis',
        label: t('public.stats.cards.trackedApis'),
        value: formatCount(overview.value.enabledTrackedApiCount),
        helper: trackedApiRatioLabel.value,
        icon: 'i-mdi-api',
        tone: 'violet'
      }
    ]
  })

  async function reloadStats() {
    await refresh()
  }

  return {
    error,
    formatCompact,
    formatCount,
    formatRate: formatPercent,
    generatedAtLabel,
    hasData,
    isInitialLoading,
    isPending,
    overview,
    overviewCards,
    rankingLast30d,
    reloadStats,
    topApi,
    trend7d,
    trendFailureCalls,
    trendSuccessCalls,
    trendTotalCalls
  }
}
