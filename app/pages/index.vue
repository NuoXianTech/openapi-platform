<script setup lang="ts">
import type { ApiCatalogItem } from '#shared/types/api'
import type {
  PublicCallStatsDashboard,
  PublicCallStatsSummary
} from '#shared/types/public-stats'
import { usePublicApiCatalog } from '~/composables/api/use-public-api-catalog'

const LIVE_STATS_REFRESH_INTERVAL_MS = 10_000
const POPULAR_API_LIMIT = 6
const { t } = useI18n()

const {
  categoryMap,
  allApis,
  isLoading,
  loadError,
  refreshCatalog,
  total: totalApiCount
} = usePublicApiCatalog({ pageSize: 100 })

const { settings } = useSiteSettings()
const {
  data: publicStats,
  pending: publicStatsLoading,
  error: publicStatsError,
  refresh: refreshPublicStats
} = useFetch<PublicCallStatsDashboard>('/api/stats/public', {
  key: 'home-public-stats',
  query: {
    days: 1,
    top: POPULAR_API_LIMIT
  }
})
const liveStats = shallowRef<PublicCallStatsSummary | null>(null)
let liveStatsRefreshTimer: ReturnType<typeof setInterval> | undefined
let liveStatsRefreshPending = false

const introSummaryLoading = computed(() =>
  publicStatsLoading.value && !liveStats.value
)
const introSummaryError = computed(() =>
  Boolean(publicStatsError.value) && !liveStats.value
)
const popularApisLoading = computed(() => isLoading.value || publicStatsLoading.value)
const popularApisLoadError = computed(() => {
  if (loadError.value) return loadError.value
  return publicStatsError.value ? t('public.home.popularLoadFailed') : null
})

async function refreshLiveStats(): Promise<void> {
  if (!settings.value.homeRequestCountEnabled || liveStatsRefreshPending || document.visibilityState !== 'visible') return

  liveStatsRefreshPending = true
  try {
    liveStats.value = await $fetch<PublicCallStatsSummary>('/api/stats/public/summary')
  } catch {
    // Background refreshes keep the last valid snapshot on transient failures.
  } finally {
    liveStatsRefreshPending = false
  }
}

onMounted(() => {
  if (publicStatsError.value) void refreshLiveStats()

  liveStatsRefreshTimer = setInterval(() => {
    void refreshLiveStats()
  }, LIVE_STATS_REFRESH_INTERVAL_MS)
})

onBeforeUnmount(() => {
  if (liveStatsRefreshTimer) clearInterval(liveStatsRefreshTimer)
})

const totalCallCount = computed(() => liveStats.value?.totalCalls
  ?? publicStats.value?.overview.totalCalls
  ?? 0)

const popularApis = computed<ApiCatalogItem[]>(() => {
  const apiByRouteId = new Map(allApis.value.flatMap(api => (
    api.endpoints.map(endpoint => [endpoint.id, api] as const)
  )))
  const selectedApis: ApiCatalogItem[] = []
  const selectedApiIds = new Set<string>()

  for (const rankingEntry of publicStats.value?.rankingLast30d ?? []) {
    const api = apiByRouteId.get(rankingEntry.routeId)
    if (!api || selectedApiIds.has(api.id)) continue
    selectedApis.push(api)
    selectedApiIds.add(api.id)
    if (selectedApis.length === POPULAR_API_LIMIT) return selectedApis
  }

  return selectedApis
})

async function refreshPopularApis(): Promise<void> {
  await Promise.all([refreshCatalog(), refreshPublicStats()])
}

useSeoMeta({
  ogTitle: () => settings.value.siteName,
  description: () => settings.value.siteDescription,
  ogDescription: () => settings.value.siteDescription,
  ogType: 'website',
  ogImage: () => settings.value.siteImg
})
</script>

<template>
  <div class="public-page">
    <CommonSiteHeader />
    <CommonPublicApiIntro
      :site-description="settings.siteDescription"
      :uptime-days="settings.uptimeDays"
      :show-call-count="settings.homeRequestCountEnabled"
      :call-count="totalCallCount"
      :summary-loading="introSummaryLoading"
      :summary-error="introSummaryError"
    />

    <main>
      <HomePopularApis
        :apis="popularApis"
        :category-map="categoryMap"
        :total-api-count="totalApiCount"
        :is-loading="popularApisLoading"
        :load-error="popularApisLoadError"
        @retry="refreshPopularApis"
      />
      <HomeApiOnboarding />
    </main>

    <CommonAppFooter class="home-footer" />
    <Suspense>
      <LazyCommonAnnouncementPopup />
      <template #fallback>
        <span class="sr-only">{{ $t('public.home.announcementLoading') }}</span>
      </template>
    </Suspense>
  </div>
</template>

<style scoped>
.public-page {
  min-height: 100dvh;
  background: var(--ui-bg);
}

.public-page > .home-footer {
  margin-top: 0;
}
</style>
