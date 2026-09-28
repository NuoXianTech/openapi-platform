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
  isEmpty,
  refreshCatalog
} = usePublicApiCatalog({ pageSize: DIRECTORY_PAGE_SIZE })

const paginatedApis = filteredApis

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

    <main class="api-directory">
      <header class="api-directory__intro">
        <div class="api-directory__copy">
          <span class="api-directory__kicker">{{ $t('public.directory.kicker') }}</span>
          <h1>{{ $t('public.directory.title') }}</h1>
          <p>{{ $t('public.directory.description') }}</p>

          <div class="api-directory__gateway">
            <span>{{ $t('public.directory.gateway') }}</span>
            <code>{{ gatewayOrigin }}</code>
          </div>
        </div>

        <div class="api-directory__count" :aria-label="$t('public.home.totalApis')">
          <strong>{{ total }}</strong>
          <span>{{ $t('public.home.totalApis') }}</span>
        </div>
      </header>

      <section
        class="api-directory__listing"
        :aria-label="$t('public.navigation.catalog')"
      >
        <div class="api-directory__controls">
          <div class="api-directory__search">
            <span class="api-directory__filter-label">
              <UIcon name="i-mdi-magnify" class="size-3.5" />
              {{ $t('public.directory.searchLabel') }}
            </span>
            <div class="api-directory__search-control">
              <CommonSearchBar
                v-model="searchQuery"
                :placeholder="$t('public.home.searchPlaceholder')"
                size="sm"
                variant="none"
              />
            </div>
          </div>

          <div class="api-directory__statuses">
            <span class="api-directory__filter-label">
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
            <span class="api-directory__filter-label">
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

        <div v-if="isLoading" class="api-directory__skeletons" aria-hidden="true">
          <USkeleton
            v-for="index in DIRECTORY_PAGE_SIZE"
            :key="index"
            class="h-52 w-full rounded-lg"
          />
        </div>

        <UEmpty
          v-else-if="loadError"
          icon="i-mdi-alert-circle-outline"
          :title="$t('common.states.loadFailed')"
          :description="loadError"
          variant="naked"
          size="lg"
          :actions="retryActions"
          class="api-directory__state"
        />

        <UEmpty
          v-else-if="isEmpty"
          icon="i-mdi-magnify-remove-outline"
          :title="$t('public.directory.emptyTitle')"
          :description="$t('public.directory.emptyDescription')"
          variant="naked"
          size="lg"
          class="api-directory__state"
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
      </section>
    </main>

    <CommonAppFooter />
  </div>
</template>

<style scoped>
.public-page {
  min-height: 100dvh;
  background: var(--ui-bg);
}

.api-directory {
  width: calc(100% - 2rem);
  max-width: 1180px;
  margin-inline: auto;
  padding-block: 3.5rem 2rem;
}

.api-directory__intro {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 2rem;
}

.api-directory__copy {
  min-width: 0;
}

.api-directory__kicker {
  display: block;
  margin-bottom: 0.5rem;
  color: var(--ui-text-highlighted);
  font-family: var(--font-code);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.api-directory h1 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(2rem, 5vw, 2.75rem);
  font-weight: 650;
  line-height: 1.15;
}

.api-directory__copy > p {
  max-width: 42rem;
  margin: 0.75rem 0 0;
  color: var(--ui-text-muted);
  font-size: 0.9rem;
  line-height: 1.7;
}

.api-directory__gateway {
  display: flex;
  width: fit-content;
  max-width: 100%;
  margin-top: 1.25rem;
  align-items: center;
  gap: 0.6rem;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  padding: 0.5rem 0.65rem;
  background: var(--ui-bg-muted);
}

.api-directory__gateway span {
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
  font-size: 0.68rem;
}

.api-directory__gateway code {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-toned);
  font-size: 0.72rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-directory__count {
  display: flex;
  min-width: 7rem;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  padding-bottom: 0.25rem;
}

.api-directory__count strong {
  color: var(--ui-text-highlighted);
  font-family: var(--font-code);
  font-size: 2rem;
  font-weight: 650;
  line-height: 1;
}

.api-directory__count span {
  margin-top: 0.4rem;
  color: var(--ui-text-dimmed);
  font-size: 0.7rem;
}

.api-directory__listing {
  margin-top: 3rem;
}

.api-directory__controls {
  display: grid;
  gap: 1rem;
}

.api-directory__statuses,
.api-directory__search,
.api-directory__categories {
  min-width: 0;
}

.api-directory__search-control {
  display: flex;
  height: 40px;
  align-items: center;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--ui-border) 82%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-bg-elevated) 64%, transparent);
  transition: background-color 160ms ease;
}

.api-directory__search-control:focus-within {
  background: var(--ui-bg);
}

.api-directory__search-control :deep([data-slot="base"]) {
  height: 30px;
  border-radius: 6px;
}

.api-directory__filter-label {
  display: inline-flex;
  margin-bottom: 0.45rem;
  align-items: center;
  gap: 0.35rem;
  color: var(--ui-text-dimmed);
  font-family: var(--font-code);
  font-size: 0.62rem;
  font-weight: 650;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.api-directory__result-meta {
  display: flex;
  margin-block: 1.25rem 0.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: var(--ui-text-muted);
  font-size: 0.72rem;
  scroll-margin-top: 5.5rem;
}

.api-directory__result-meta span {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.api-directory__skeletons {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

.api-directory__state {
  padding-block: 3rem;
}

.api-directory__pagination {
  display: flex;
  margin-top: 2rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-top: 1px solid var(--ui-border);
  padding-top: 1.25rem;
}

.api-directory__pagination > span {
  color: var(--ui-text-muted);
  font-family: var(--font-code);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

@media (width >= 640px) {
  .api-directory__skeletons {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (width >= 1024px) {
  .api-directory__skeletons {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (width >= 800px) {
  .api-directory__controls {
    grid-template-columns: minmax(260px, 0.7fr) minmax(0, 1.3fr);
    align-items: start;
  }

  .api-directory__categories {
    grid-column: 1 / -1;
  }
}

@media (width >= 1120px) {
  .api-directory__controls {
    grid-template-columns: minmax(240px, 0.72fr) minmax(340px, 1fr) minmax(0, 1.15fr);
  }

  .api-directory__categories {
    grid-column: auto;
  }
}

@media (width < 640px) {
  .api-directory {
    padding-top: 2.75rem;
  }

  .api-directory__intro {
    align-items: flex-start;
  }

  .api-directory__count {
    display: none;
  }

  .api-directory__listing {
    margin-top: 2.25rem;
  }

  .api-directory__hint {
    display: none !important;
  }

  .api-directory__pagination {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
