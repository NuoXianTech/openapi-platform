<script setup lang="ts">
const props = withDefaults(defineProps<{
  size?: 'default' | 'auth'
}>(), {
  size: 'default'
})

const { settings } = useSiteSettings()
</script>

<template>
  <NuxtLink
    to="/"
    class="site-brand"
    :class="{ 'site-brand--auth': props.size === 'auth' }"
    :aria-label="settings.siteName"
  >
    <span
      class="site-brand__mark"
      aria-hidden="true"
    >
      <img
        :src="settings.siteImg || '/favicon.ico'"
        alt=""
        width="20"
        height="20"
        decoding="async"
      >
    </span>
    <span class="site-brand__copy">
      <strong>{{ settings.siteName }}</strong>
    </span>
  </NuxtLink>
</template>

<style scoped>
.site-brand {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.625rem;
  color: var(--ui-text-highlighted);
}

.site-brand__mark {
  display: grid;
  width: 2rem;
  height: 2rem;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in oklab, var(--ui-border) 88%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, var(--ui-bg-elevated) 94%, transparent);
  box-shadow: 0 1px 2px color-mix(in oklab, var(--ui-text) 7%, transparent);
}

.site-brand__mark img {
  width: 1.25rem;
  height: 1.25rem;
  object-fit: contain;
}

.site-brand__copy {
  display: flex;
  align-items: center;
  line-height: 1;
}

.site-brand__copy strong {
  max-width: 13rem;
  overflow: hidden;
  font-family: var(--font-display);
  font-size: 0.875rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-brand--auth {
  gap: 0.75rem;
}

.site-brand--auth .site-brand__mark {
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 12px;
}

.site-brand--auth .site-brand__mark img {
  width: 2rem;
  height: 2rem;
}

.site-brand--auth .site-brand__copy strong {
  max-width: 16rem;
  font-size: 1rem;
  line-height: 1.2;
}
</style>
