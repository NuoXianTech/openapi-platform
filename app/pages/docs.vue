<script setup lang="ts">
import { usePublicApiCatalog } from '~/composables/api/use-public-api-catalog'

definePageMeta({ layout: false })

const DIRECTORY_PAGE_SIZE = 12
const { t } = useI18n()
const requestUrl = useRequestURL()
const { settings } = useSiteSettings()
const gatewayOrigin = computed(() => settings.value.siteUrl || requestUrl.origin)
const {
  searchQuery,
  selectedStatus,
  selectedCategory,
  statusTabs,
  categoryTabs,
  categoryMap,
  filteredApis,
  page,
  pageSize,
  total,
  totalPages,
  isLoading,
  loadError,
  refreshCatalog
} = usePublicApiCatalog({ pageSize: DIRECTORY_PAGE_SIZE })

const paginatedApis = filteredApis
const resultState = computed(() => {
  if (isLoading.value && !paginatedApis.value.length) return 'loading'
  if (loadError.value && !isLoading.value) return 'error'
  return paginatedApis.value.length ? 'content' : 'empty'
})

const retryActions = computed(() => [{
  label: t('common.actions.retry'),
  color: 'neutral' as const,
  variant: 'outline' as const,
  icon: 'i-lucide-refresh-cw',
  onClick: refreshCatalog
}])

async function handlePageChange(nextPage: number): Promise<void> {
  page.value = nextPage
  await nextTick()
  document.getElementById('api-directory-results')?.scrollIntoView({ block: 'start' })
}

useHead(() => ({ title: t('public.directory.pageTitle') }))
useSeoMeta({
  description: () => t('public.directory.seoDescription'),
  ogTitle: () => t('public.directory.pageTitle'),
  ogDescription: () => t('public.directory.seoDescription')
})
</script>

<template>
  <div class="public-page">
    <CommonSiteHeader />

    <main class="api-directory public-content">
      <header class="api-directory__intro public-page-heading">
        <div class="api-directory__copy">
          <span class="public-eyebrow">{{ $t('public.directory.kicker') }}</span>
          <h1>{{ $t('public.directory.title') }}</h1>
          <p>{{ $t('public.directory.description') }}</p>

          <div class="api-directory__gateway">
            <span>{{ $t('public.directory.gateway') }}</span>
            <code>{{ gatewayOrigin }}</code>
          </div>
        </div>

        <div class="public-count" :aria-label="$t('public.home.totalApis')">
          <USkeleton v-if="isLoading" class="h-12 w-20" :aria-label="$t('common.states.loading')" />
          <strong v-else>{{ loadError ? '—' : total }}</strong>
          <span>{{ $t('public.home.totalApis') }}</span>
        </div>
      </header>

      <section
        class="api-directory__listing"
        :aria-label="$t('public.navigation.catalog')"
      >
        <div class="api-directory__controls public-filter-panel">
          <div class="api-directory__search">
            <span class="public-filter-label">
              <UIcon name="i-mdi-magnify" class="size-3.5" />
              {{ $t('public.directory.searchLabel') }}
            </span>
            <div class="public-search-control">
              <CommonSearchBar
                v-model="searchQuery"
                :placeholder="$t('public.home.searchPlaceholder')"
                size="sm"
                variant="none"
              />
            </div>
          </div>

          <div class="api-directory__statuses">
            <span class="public-filter-label">
              <UIcon name="i-mdi-pulse" class="size-3.5" />
              {{ $t('public.home.statusFilter') }}
            </span>
            <CommonFilterTabs
              v-model="selectedStatus"
              :tabs="statusTabs"
              :enable-collapse="false"
              :aria-label="t('public.home.statusFilterAria')"
            />
          </div>

          <div class="api-directory__categories">
            <span class="public-filter-label">
              <UIcon name="i-mdi-shape-outline" class="size-3.5" />
              {{ $t('public.directory.categoryLabel') }}
            </span>
            <CommonFilterTabs
              v-model="selectedCategory"
              :tabs="categoryTabs"
              :max-visible="10"
              :search-placeholder="t('public.home.categorySearch')"
              :empty-text="t('public.home.categoryEmpty')"
              :aria-label="t('public.home.categoryFilterAria')"
            />
          </div>
        </div>

        <div id="api-directory-results" class="api-directory__result-meta">
          <span>
            <UIcon name="i-mdi-filter-variant" class="size-3.5" />
            {{ $t('public.directory.resultSummary', { count: total }) }}
          </span>
          <span class="api-directory__hint">
            <UIcon name="i-mdi-cursor-default-click-outline" class="size-3.5" />
            {{ $t('public.directory.resultHint') }}
          </span>
        </div>

        <CommonStateTransition
          :state-key="resultState"
          :busy="isLoading"
          :refreshing="isLoading && paginatedApis.length > 0"
          class="api-directory__result-state"
        >
          <div v-if="resultState === 'loading'" class="api-directory__skeletons" aria-hidden="true">
            <USkeleton
              v-for="index in DIRECTORY_PAGE_SIZE"
              :key="index"
              class="h-60 w-full rounded-xl"
            />
          </div>

          <UEmpty
            v-else-if="resultState === 'error'"
            icon="i-mdi-alert-circle-outline"
            :title="$t('common.states.loadFailed')"
            :description="loadError || undefined"
            variant="naked"
            size="lg"
            :actions="retryActions"
            class="public-empty"
          />

          <UEmpty
            v-else-if="resultState === 'empty'"
            icon="i-mdi-magnify-remove-outline"
            :title="$t('public.directory.emptyTitle')"
            :description="$t('public.directory.emptyDescription')"
            variant="naked"
            size="lg"
            class="public-empty"
          />

          <div v-else class="api-directory__results">
            <ApiCardGrid
              :apis="paginatedApis"
              :category-map="categoryMap"
            />

            <nav
              class="api-directory__pagination"
              :aria-label="$t('public.directory.paginationAria')"
            >
              <span>
                {{ $t('public.directory.pagination', { page, totalPages }) }}
              </span>
              <UPagination
                :page="page"
                :items-per-page="pageSize"
                :total="total"
                :sibling-count="1"
                show-edges
                size="sm"
                :ui="{ first: 'hidden', last: 'hidden', list: 'gap-0.5 sm:gap-1' }"
                @update:page="handlePageChange"
              />
            </nav>
          </div>
        </CommonStateTransition>
      </section>
    </main>

    <CommonAppFooter />
  </div>
</template>

<style scoped>
.api-directory__intro {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 40px;
}

.api-directory__copy { min-width: 0; }

.api-directory__gateway {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding: 8px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-bg-elevated);
}

.api-directory__gateway span {
  flex-shrink: 0;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.api-directory__gateway code {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-directory__listing { margin-top: 32px; }

.api-directory__search,
.api-directory__statuses,
.api-directory__categories { min-width: 0; }

.api-directory__categories {
  padding-top: 20px;
  border-top: 1px solid var(--ui-border);
}

.api-directory__result-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-block: 32px 16px;
  color: var(--ui-text-muted);
  font-size: 12px;
  scroll-margin-top: 88px;
}

.api-directory__result-meta span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.api-directory__result-state { min-height: 280px; }

.api-directory__skeletons {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.api-directory__pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--ui-border);
}

.api-directory__pagination > span {
  color: var(--ui-text-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

@media (width >= 640px) {
  .api-directory__skeletons { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (width >= 1024px) {
  .api-directory__skeletons { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .api-directory__controls {
    grid-template-columns: minmax(260px, 0.7fr) minmax(0, 1.3fr);
    align-items: start;
  }
  .api-directory__categories { grid-column: 1 / -1; }
}

@media (width < 640px) {
  .api-directory__intro { align-items: flex-start; flex-direction: column; gap: 24px; }
  .api-directory__hint { display: none !important; }
  .api-directory__pagination { align-items: flex-start; flex-direction: column; }
}
</style>
