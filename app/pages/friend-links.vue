<script setup lang="ts">
import { useFriendLinkList } from '~/composables/use-friend-link-list'

const { t } = useI18n()
useHead(() => ({ title: t('public.friendLinks.title') }))
useSeoMeta({
  description: () => t('public.friendLinks.seoDescription'),
  ogTitle: () => t('public.friendLinks.title'),
  ogDescription: () => t('public.friendLinks.seoDescription')
})

const query = ref('')
const currentStatus = ref<string | number>('all')

const statusTabs = computed(() => [
  { label: t('common.filters.all'), value: 'all' },
  { label: t('common.states.active'), value: 1 },
  { label: t('common.states.inactive'), value: 0 }
])

const retryActions = computed(() => [{
  label: t('common.actions.retry'),
  color: 'neutral' as const,
  variant: 'outline' as const,
  icon: 'i-lucide-refresh-cw',
  onClick: fetchFriendLinks
}])

const {
  items,
  loading,
  error,
  fetchFriendLinks
} = useFriendLinkList()

const filteredItems = computed(() => {
  const keyword = query.value.trim().toLowerCase()
  return items.value.filter((item) => {
    const keywordMatched = !keyword
      || item.title.toLowerCase().includes(keyword)
      || (item.description || '').toLowerCase().includes(keyword)
      || item.url.toLowerCase().includes(keyword)
    const statusMatched = currentStatus.value === 'all'
      || Number(item.isActive) === Number(currentStatus.value)

    return keywordMatched && statusMatched
  })
})

const isFilteredEmpty = computed(() => filteredItems.value.length === 0 && items.value.length > 0)
const resultState = computed(() => {
  if (loading.value && !items.value.length) return 'loading'
  if (error.value && !loading.value) return 'error'
  if (!items.value.length) return 'empty'
  return isFilteredEmpty.value ? 'filtered-empty' : 'content'
})

const totalCount = computed(() => items.value.length)
const activeCount = computed(() => items.value.filter(item => item.isActive).length)
const visibleCount = computed(() => filteredItems.value.length)
</script>

<template>
  <div class="public-page">
    <CommonSiteHeader />
    <main class="friend-links-main">
      <CommonFriendLinksHero
        :total-count="totalCount"
        :active-count="activeCount"
      />

      <section class="friend-links-browser">
        <div class="friend-links-toolbar">
          <div class="friend-links-search">
            <CommonSearchBar
              v-model="query"
              :placeholder="t('public.friendLinks.searchPlaceholder')"
              size="lg"
            />
          </div>

          <div class="friend-links-status-filter">
            <span class="friend-links-filter-label">
              <UIcon
                name="i-mdi-pulse"
                class="size-3.5"
              />
              {{ $t('public.friendLinks.statusFilter') }}
            </span>
            <CommonFilterTabs
              v-model="currentStatus"
              :tabs="statusTabs"
              :enable-collapse="false"
              :aria-label="t('public.friendLinks.statusFilterAria')"
            />
          </div>
        </div>

        <div
          v-if="items.length > 0 && (!error || loading)"
          class="friend-links-result-meta"
        >
          <span>
            <UIcon
              name="i-mdi-format-list-bulleted"
              class="size-3.5"
            />
            {{ $t('public.friendLinks.visibleCount', { count: visibleCount }) }}
          </span>
          <span
            v-if="!isFilteredEmpty"
            class="friend-links-result-hint"
          >
            <UIcon
              name="i-mdi-cursor-default-click-outline"
              class="size-3.5"
            />
            {{ $t('public.friendLinks.clickHint') }}
          </span>
        </div>

        <CommonStateTransition
          :state-key="resultState"
          :busy="loading"
          :refreshing="loading && items.length > 0"
          class="friend-links-result-state"
        >
          <section
            v-if="resultState === 'loading'"
            key="loading"
            class="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
            aria-hidden="true"
          >
            <USkeleton v-for="index in 6" :key="index" class="h-44 rounded-lg" />
          </section>

          <section
            v-else-if="resultState === 'error'"
            key="error"
            class="friend-links-state"
          >
            <UEmpty
              icon="i-mdi-alert-circle-outline"
              :title="t('common.states.loadFailed')"
              :description="error || undefined"
              variant="naked"
              size="lg"
              :actions="retryActions"
            />
          </section>

          <section
            v-else-if="resultState === 'empty'"
            key="empty"
            class="friend-links-state"
          >
            <UEmpty
              icon="i-mdi-link-variant-off"
              :title="t('public.friendLinks.emptyTitle')"
              :description="t('public.friendLinks.emptyDescription')"
              variant="naked"
              size="lg"
            />
          </section>

          <section
            v-else-if="resultState === 'filtered-empty'"
            key="filtered-empty"
            class="friend-links-state"
          >
            <UEmpty
              icon="i-mdi-magnify-close"
              :title="t('public.friendLinks.noMatchTitle')"
              :description="t('public.friendLinks.noMatchDescription')"
              variant="naked"
              size="lg"
            />
          </section>

          <section
            v-else
            key="content"
            class="friend-links-results"
          >
            <LinkList :items="filteredItems" />
          </section>
        </CommonStateTransition>
      </section>
    </main>

    <CommonAppFooter />
  </div>
</template>

<style scoped>
.friend-links-main {
  width: calc(100% - 2rem);
  max-width: 73.75rem;
  flex: 1;
  margin-inline: auto;
  padding-block: 3.5rem 2rem;
}

.friend-links-browser {
  margin-top: 3rem;
}

.friend-links-toolbar {
  display: grid;
  gap: 1rem;
}

.friend-links-search {
  min-width: 0;
}

.friend-links-status-filter {
  min-width: 0;
}

.friend-links-filter-label {
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

.friend-links-result-meta {
  display: flex;
  margin-block: 1.25rem 0.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: var(--ui-text-muted);
  font-size: 0.72rem;
}

.friend-links-result-meta span {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.friend-links-results {
  min-width: 0;
}

.friend-links-result-state {
  min-height: 16rem;
}

.friend-links-state {
  padding-block: 3rem;
}

@media (width >= 800px) {
  .friend-links-toolbar {
    grid-template-columns: minmax(0, 1fr) minmax(20rem, 22rem);
    align-items: end;
  }
}

@media (width < 640px) {
  .friend-links-main {
    padding-top: 2.75rem;
  }

  .friend-links-browser {
    margin-top: 2.25rem;
  }

  .friend-links-result-hint {
    display: none !important;
  }
}
</style>
