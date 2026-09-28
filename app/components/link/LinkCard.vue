<script setup lang="ts">
import { isSafePublicUrl } from '#shared/utils/safe-url'

interface LinkCardProps {
  title?: string
  description?: string
  url?: string
  status?: number
}
const { t } = useI18n()

const props = withDefaults(defineProps<LinkCardProps>(), {
  title: '',
  description: '',
  url: '#',
  status: -1
})

const displayDescription = computed(() => {
  const value = props.description?.trim()
  return value || t('common.content.noDescription')
})

const safeUrl = computed(() => isSafePublicUrl(props.url) ? props.url : '#')

const displayHost = computed(() => {
  try {
    const url = new URL(safeUrl.value)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return safeUrl.value
  }
})

const displayInitial = computed(() => {
  const t = props.title.trim()
  return t ? t[0]?.toUpperCase() : '?'
})

const isActive = computed(() => props.status === 1)
</script>

<template>
  <a
    :href="safeUrl"
    target="_blank"
    rel="noopener"
    class="link-card group"
    :class="{ 'link-card--inactive': !isActive }"
  >
    <span
      class="link-card__spotlight"
      aria-hidden="true"
    />

    <div class="link-card__top">
      <UAvatar
        :text="displayInitial"
        size="md"
        class="link-card__avatar"
      />
      <UBadge
        :color="isActive ? 'success' : 'error'"
        variant="soft"
        size="sm"
        class="rounded-md"
      >
        <span
          class="link-card__dot"
          :class="isActive ? 'link-card__dot--ok' : 'link-card__dot--err'"
        />
        {{ isActive ? $t('common.states.active') : $t('common.states.inactive') }}
      </UBadge>
    </div>

    <div class="link-card__body">
      <h3 class="link-card__title">
        {{ props.title || $t('public.friendLinks.defaultTitle') }}
      </h3>
      <UTooltip
        :text="displayDescription"
        :content="{ side: 'top' }"
      >
        <p class="link-card__desc">
          {{ displayDescription }}
        </p>
      </UTooltip>
    </div>

    <div class="link-card__footer">
      <UTooltip
        :text="safeUrl"
        :content="{ side: 'top' }"
      >
        <span class="link-card__host">
          <UIcon
            name="i-mdi-earth"
            class="size-3"
          />
          {{ displayHost }}
        </span>
      </UTooltip>
      <span class="link-card__cta">
        {{ $t('common.actions.visit') }}
        <UIcon
          name="i-mdi-arrow-top-right"
          class="size-3.5"
        />
      </span>
    </div>
  </a>
</template>

<style scoped>
.link-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--ui-border) 86%, transparent);
  background: var(--ui-bg-elevated);
  border-radius: 8px;
  padding: 16px;
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  isolation: isolate;
  min-height: 168px;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.dark .link-card {
  background: var(--ui-bg-elevated);
}

.link-card::after { display: none; }

.link-card:hover {
  border-color: color-mix(in oklab, var(--ui-primary) 32%, var(--ui-border));
  background: color-mix(in oklab, var(--ui-primary) 3%, var(--ui-bg-elevated));
}

.dark .link-card:hover {
  box-shadow: none;
}

.link-card__spotlight {
  position: absolute;
  inset: -1px;
  pointer-events: none;
  border-radius: inherit;
  background: transparent;
  opacity: 0;
  transition: opacity 240ms ease;
  z-index: 0;
}

.link-card:hover .link-card__spotlight {
  opacity: 1;
}

.link-card__top {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.link-card__avatar {
  transition: border-color 160ms ease;
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent) !important;
  color: var(--ui-text) !important;
  border: 1px solid color-mix(in srgb, var(--ui-border) 82%, transparent);
}

.link-card:hover .link-card__avatar {
  border-color: color-mix(in oklab, var(--ui-primary) 38%, var(--ui-border));
}

.link-card__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-block;
  margin-right: 4px;
}

.link-card__dot--ok {
  background: var(--ui-success);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-success) 28%, transparent);
}

.link-card__dot--err {
  background: var(--ui-error);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--ui-error) 28%, transparent);
}

.link-card__body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.link-card__title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0;
  color: var(--ui-text);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.link-card__desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--ui-text-muted);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.link-card__footer {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--ui-border);
  font-size: 12px;
}

.link-card__host {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--ui-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.link-card__cta {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--ui-text-muted);
  font-weight: 500;
  transition: color 200ms ease, gap 200ms ease;
  flex-shrink: 0;
}

.link-card:hover .link-card__cta {
  color: var(--ui-text);
  gap: 6px;
}

.link-card--inactive .link-card__avatar {
  background: color-mix(in srgb, var(--ui-text-muted) 18%, transparent) !important;
  color: var(--ui-text-muted) !important;
}

.link-card--inactive .link-card__title {
  color: var(--ui-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .link-card__cta { transition: none; }
  .link-card:hover .link-card__cta { gap: 3px; }
}
</style>
