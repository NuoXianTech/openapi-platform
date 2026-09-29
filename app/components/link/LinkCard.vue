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
    rel="noopener noreferrer"
    class="link-card group"
    :class="{ 'link-card--inactive': !isActive }"
  >
    <div class="link-card__top">
      <UAvatar
        :text="displayInitial"
        size="md"
        class="link-card__avatar"
      />
      <UBadge
        :color="isActive ? 'neutral' : 'error'"
        variant="outline"
        size="sm"
        class="link-card__status"
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
  display: flex;
  min-width: 0;
  min-height: 240px;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  text-decoration: none;
  transition: border-color 160ms ease;
}

.link-card:hover { border-color: var(--ui-border-accented); }
.link-card:focus-visible { outline: 2px solid var(--ui-ring); outline-offset: 4px; }

.link-card__top,
.link-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.link-card__avatar {
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-bg);
  color: var(--ui-text-highlighted);
}

.link-card__status {
  gap: 6px;
  padding: 0;
  border-radius: 0;
  background: transparent;
  font-size: 11px;
  font-weight: 400;
  box-shadow: none;
}

.link-card__dot {
  width: 5px;
  height: 5px;
  flex-shrink: 0;
  border-radius: 50%;
}

.link-card__dot--ok { background: var(--ui-text-toned); }
.link-card__dot--err { background: var(--ui-error); }

.link-card__body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
}

.link-card__title {
  margin: 0;
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  letter-spacing: -0.4px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-card__desc {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 14px;
  line-height: 22px;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.link-card__footer {
  padding-top: 16px;
  border-top: 1px solid var(--ui-border);
  font-size: 12px;
}

.link-card__host {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--ui-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-card__cta {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  color: var(--ui-text-toned);
}

.link-card__cta :deep(.iconify) { transition: transform 160ms ease; }
.link-card:hover .link-card__cta :deep(.iconify) { transform: translate(2px, -2px); }
.link-card--inactive .link-card__avatar { color: var(--ui-text-muted); }

@media (prefers-reduced-motion: reduce) {
  .link-card,
  .link-card__cta :deep(.iconify) { transition: none; }
  .link-card:hover .link-card__cta :deep(.iconify) { transform: none; }
}
</style>
