<script setup lang="ts">
type HttpMethodBadgeSize = 'xs' | 'sm'

const props = withDefaults(defineProps<{
  method: string
  size?: HttpMethodBadgeSize
}>(), {
  size: 'sm'
})

const normalizedMethod = computed(() => props.method.trim().toUpperCase() || 'HTTP')
const methodTone = computed(() => {
  switch (normalizedMethod.value) {
    case 'GET':
    case 'HEAD':
      return 'blue'
    case 'POST':
      return 'violet'
    case 'PUT':
    case 'PATCH':
      return 'amber'
    case 'DELETE':
      return 'rose'
    default:
      return 'ink'
  }
})
</script>

<template>
  <span
    class="http-method-badge"
    :class="[`is-${methodTone}`, `is-${size}`]"
  >
    {{ normalizedMethod }}
  </span>
</template>

<style scoped>
.http-method-badge {
  --http-method-accent: var(--ui-text-toned);
  display: inline-flex;
  width: fit-content;
  flex: 0 0 auto;
  align-items: center;
  border: 1px solid color-mix(in oklab, var(--http-method-accent) 30%, var(--ui-border));
  border-radius: 6px;
  background: color-mix(in oklab, var(--http-method-accent) 7%, var(--ui-bg-elevated));
  color: color-mix(in oklab, var(--http-method-accent) 88%, var(--ui-text-highlighted));
  box-shadow: none;
  font-family: var(--font-code);
  font-weight: 500;
  letter-spacing: 0;
  line-height: 1rem;
  white-space: nowrap;
}

.http-method-badge.is-xs {
  min-height: 1.25rem;
  padding-inline: 0.375rem;
  font-size: 0.75rem;
}

.http-method-badge.is-sm {
  min-height: 1.5rem;
  padding-inline: 0.5rem;
  font-size: 0.75rem;
}

.http-method-badge.is-blue { --http-method-accent: var(--api-spectrum-blue); }
.http-method-badge.is-violet { --http-method-accent: var(--api-spectrum-violet); }
.http-method-badge.is-amber { --http-method-accent: var(--api-spectrum-amber); }
.http-method-badge.is-rose { --http-method-accent: var(--api-spectrum-rose); }

.dark .http-method-badge {
  border-color: color-mix(in oklab, var(--http-method-accent) 38%, var(--ui-border));
  background: color-mix(in oklab, var(--http-method-accent) 13%, var(--ui-bg-elevated));
  color: color-mix(in oklab, var(--http-method-accent) 92%, white);
  box-shadow: none;
}
</style>
