<script setup lang="ts">
import type { InputProps } from '@nuxt/ui'

interface Props {
  modelValue?: string
  placeholder?: string
  size?: InputProps['size']
  variant?: InputProps['variant']
}

const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  placeholder: '',
  size: 'md',
  variant: 'outline'
})
const { t } = useI18n()
const resolvedPlaceholder = computed(() => props.placeholder || t('public.home.searchPlaceholder'))

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

type InputExpose = {
  inputRef?: HTMLInputElement | { value: HTMLInputElement | null } | null
}

const inputComp = ref<InputExpose | null>(null)
const searchInputUi = {
  base: 'focus-visible:outline-none focus-visible:ring-accented'
}

const getInputElement = () => {
  const inputRef = inputComp.value?.inputRef
  if (!inputRef) return null
  if ('focus' in inputRef) return inputRef
  return inputRef.value
}

const focusInput = () => {
  getInputElement()?.focus()
}

const handleInput = (value: string | number) => {
  emit('update:modelValue', String(value ?? ''))
}

const clear = () => {
  emit('update:modelValue', '')
  focusInput()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && props.modelValue) {
    event.preventDefault()
    clear()
  }
}

defineShortcuts({
  '/': focusInput
})
</script>

<template>
  <UInput
    ref="inputComp"
    :model-value="props.modelValue"
    :placeholder="resolvedPlaceholder"
    :aria-label="resolvedPlaceholder"
    :size="props.size"
    :variant="props.variant"
    icon="i-mdi-magnify"
    color="neutral"
    class="w-full"
    :ui="searchInputUi"
    autocomplete="off"
    @update:model-value="handleInput"
    @keydown="onKeydown"
  >
    <template #trailing>
      <UButton
        v-if="props.modelValue"
        color="neutral"
        variant="link"
        size="sm"
        icon="i-mdi-close"
        :aria-label="t('common.search.clear')"
        @click="clear"
      />
      <UKbd
        v-else
        class="searchbar-shortcut"
      >
        /
      </UKbd>
    </template>
  </UInput>
</template>

<style scoped>
.searchbar-shortcut {
  display: none;
}

@media (min-width: 640px) {
  .searchbar-shortcut {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ui-text-muted);
  }
}
</style>
