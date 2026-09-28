<script setup lang="ts">
import type { ApiCatalogItem, ApiCategoryItem } from '#shared/types/api'

interface PopularApisProps {
  apis?: ApiCatalogItem[]
  categoryMap?: Record<number, ApiCategoryItem>
  totalApiCount?: number
  isLoading?: boolean
  loadError?: string | null
}

const props = withDefaults(defineProps<PopularApisProps>(), {
  apis: () => [],
  categoryMap: () => ({}),
  totalApiCount: 0,
  isLoading: false,
  loadError: null
})

const emit = defineEmits<{
  retry: []
}>()

const { t } = useI18n()
const resultState = computed(() => {
  if (props.isLoading && !props.apis.length) return 'loading'
  if (props.loadError && !props.isLoading) return 'error'
  return props.apis.length ? 'content' : 'empty'
})
const retryActions = computed(() => [{
  label: t('common.actions.retry'),
  color: 'neutral' as const,
  variant: 'outline' as const,
  icon: 'i-lucide-refresh-cw',
  onClick: () => emit('retry')
}])
const emptyActions = computed(() => [{
  label: t('public.home.popularEmptyAction'),
  to: '/docs',
  color: 'neutral' as const,
  variant: 'outline' as const,
  trailingIcon: 'i-mdi-arrow-right'
}])
</script>

<template>
  <section
    id="popular-apis"
    class="popular-apis"
    aria-labelledby="popular-apis-title"
  >
    <div class="popular-apis__heading">
      <div>
        <span class="popular-apis__kicker">{{ $t('public.home.popularKicker') }}</span>
        <h2 id="popular-apis-title">
          {{ $t('public.home.popularTitle') }}
        </h2>
        <p>{{ $t('public.home.popularDescription') }}</p>
      </div>

      <UButton
        v-if="props.apis.length > 0 && props.totalApiCount > 0"
        to="/docs"
        color="neutral"
        variant="outline"
        trailing-icon="i-mdi-arrow-right"
      >
        {{ $t('public.home.viewAllApis', { count: props.totalApiCount }) }}
      </UButton>
    </div>

    <CommonStateTransition
      :state-key="resultState"
      :busy="props.isLoading"
      :refreshing="props.isLoading && props.apis.length > 0"
      class="popular-apis__results"
    >
      <div v-if="resultState === 'loading'" class="popular-apis__grid" aria-hidden="true">
        <USkeleton
          v-for="index in 6"
          :key="index"
          class="h-52 w-full rounded-lg"
        />
      </div>

      <UEmpty
        v-else-if="resultState === 'error'"
        icon="i-mdi-alert-circle-outline"
        :title="$t('common.states.loadFailed')"
        :description="props.loadError || undefined"
        variant="naked"
        size="lg"
        :actions="retryActions"
        class="popular-apis__state"
      />

      <UEmpty
        v-else-if="resultState === 'empty'"
        icon="i-lucide-compass"
        :title="$t('public.home.popularEmptyTitle')"
        :description="$t('public.home.popularEmptyDescription')"
        variant="naked"
        size="lg"
        :actions="emptyActions"
        class="popular-apis__state"
      />

      <ApiCardGrid
        v-else
        :apis="props.apis"
        :category-map="props.categoryMap"
        class="popular-apis__list"
      />
    </CommonStateTransition>
  </section>
</template>

<style scoped>
.popular-apis {
  width: calc(100% - 2rem);
  max-width: 1180px;
  margin-inline: auto;
  padding-block: 4.5rem;
}

.popular-apis__heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
}

.popular-apis__kicker {
  display: block;
  margin-bottom: 0.4rem;
  color: var(--ui-text-highlighted);
  font-family: var(--font-code);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.popular-apis h2 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(1.75rem, 4vw, 2.25rem);
  font-weight: 650;
  line-height: 1.2;
}

.popular-apis p {
  max-width: 38rem;
  margin: 0.55rem 0 0;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
  line-height: 1.65;
}

.popular-apis__results {
  margin-top: 2rem;
  min-height: 16rem;
}

.popular-apis__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
}

@media (width >= 640px) {
  .popular-apis__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (width >= 1024px) {
  .popular-apis__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (width < 640px) {
  .popular-apis {
    padding-block: 3.5rem;
  }

  .popular-apis__heading {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
