<script setup lang="ts">
interface Props {
  totalCount?: number
  activeCount?: number
  loading?: boolean
  hasError?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  totalCount: 0,
  activeCount: 0,
  loading: false,
  hasError: false
})

const ratio = computed(() => {
  if (props.totalCount <= 0) return 0
  return Math.round((props.activeCount / props.totalCount) * 100)
})
const formattedRatio = computed(() => props.totalCount > 0 ? `${ratio.value}%` : '--')
</script>

<template>
  <header
    class="links-hero public-page-heading"
    aria-labelledby="friend-links-title"
  >
    <div class="links-hero__copy">
      <span class="public-eyebrow">{{ $t('public.friendLinks.kicker') }}</span>
      <h1 id="friend-links-title">
        {{ $t('public.friendLinks.title') }}
      </h1>
      <p>{{ $t('public.friendLinks.description') }}</p>

      <div
        v-if="totalCount > 0"
        class="links-hero__availability"
      >
        <span>{{ $t('public.friendLinks.availability') }}</span>
        <code>{{ formattedRatio }}</code>
      </div>
    </div>

    <div
      class="public-count"
      :aria-label="$t('public.friendLinks.collected')"
    >
      <USkeleton v-if="loading" class="h-12 w-20" :aria-label="$t('common.states.loading')" />
      <strong v-else>{{ hasError ? '—' : totalCount }}</strong>
      <span>{{ $t('public.friendLinks.collected') }}</span>
    </div>
  </header>
</template>

<style scoped>
.links-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 40px;
}

.links-hero__copy { min-width: 0; }

.links-hero__availability {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding: 8px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-bg-elevated);
  font-size: 12px;
}

.links-hero__availability span { color: var(--ui-text-muted); }
.links-hero__availability code { color: var(--ui-text-highlighted); }

@media (width < 640px) {
  .links-hero { align-items: flex-start; flex-direction: column; gap: 24px; }
}
</style>
