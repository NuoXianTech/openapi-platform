<script setup lang="ts">
type HeroStatTone = 'ink' | 'blue' | 'violet' | 'bronze' | 'rose'

const { icon = '', iconTone = 'ink', loading = false, valueTitle, labelTitle } = defineProps<{
  icon?: string
  iconTone?: HeroStatTone
  loading?: boolean
  valueTitle?: string
  labelTitle?: string
}>()
</script>

<template>
  <div class="hero-stat-card">
    <template v-if="loading">
      <USkeleton class="mb-1 size-[26px] rounded-md" />
      <USkeleton class="h-6 w-20 rounded-md" />
      <USkeleton class="mt-1 h-3 w-14 rounded-md" />
    </template>
    <template v-else>
      <div
        class="hero-stat-card__icon"
        :class="`is-${iconTone}`"
      >
        <UIcon
          :name="icon"
          class="size-4"
        />
      </div>
      <UTooltip
        :text="valueTitle"
        :content="{ side: 'top' }"
        :disabled="!valueTitle"
      >
        <div class="hero-stat-card__value">
          <slot name="value" />
        </div>
      </UTooltip>
      <UTooltip
        :text="labelTitle"
        :content="{ side: 'top' }"
        :disabled="!labelTitle"
      >
        <div class="hero-stat-card__label">
          <slot />
        </div>
      </UTooltip>
    </template>
  </div>
</template>

<style scoped>
.hero-stat-card {
  position: relative;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 12px 14px;
  border: 1px solid color-mix(in srgb, var(--ui-border) 86%, transparent);
  border-radius: 8px;
  background: color-mix(in oklab, var(--ui-bg) 62%, var(--ui-bg-elevated));
  transition: border-color 160ms ease, background-color 160ms ease;
}

.hero-stat-card:hover {
  border-color: var(--ui-border-accented);
  background: var(--ui-bg-elevated);
}

.dark .hero-stat-card {
  background: color-mix(in oklab, var(--ui-bg) 60%, var(--ui-bg-elevated));
}

.hero-stat-card__icon {
  --hero-stat-accent: var(--ui-text-toned);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  margin-bottom: 4px;
  border: 1px solid color-mix(in oklab, var(--hero-stat-accent) 20%, var(--ui-border));
  border-radius: 6px;
  background: color-mix(in oklab, var(--hero-stat-accent) 7%, var(--ui-bg-elevated));
  color: var(--hero-stat-accent);
  box-shadow: inset 0 1px 0 color-mix(in oklab, white 44%, transparent);
}

.hero-stat-card__icon.is-blue { --hero-stat-accent: var(--dashboard-accent-blue); }
.hero-stat-card__icon.is-violet { --hero-stat-accent: var(--dashboard-accent-violet); }
.hero-stat-card__icon.is-bronze { --hero-stat-accent: var(--dashboard-accent-bronze); }
.hero-stat-card__icon.is-rose { --hero-stat-accent: var(--dashboard-accent-rose); }

.dark .hero-stat-card__icon {
  box-shadow: inset 0 1px 0 color-mix(in oklab, white 8%, transparent);
}

.hero-stat-card__value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 22px;
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: 0;
  color: var(--ui-text-highlighted);
  font-variant-numeric: tabular-nums;
}

.hero-stat-card__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: var(--ui-text-muted);
  letter-spacing: 0;
}

@media (max-width: 640px) {
  .hero-stat-card__value {
    font-size: 18px;
  }

  .hero-stat-card__icon {
    width: 22px;
    height: 22px;
  }
}
</style>
