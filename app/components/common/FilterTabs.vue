<script setup lang="ts">
interface FilterTabOption {
  label: string
  value: string | number
}

const props = withDefaults(defineProps<{
  modelValue: string | number
  tabs: FilterTabOption[]
  ariaLabel?: string
  maxVisible?: number
  enableCollapse?: boolean
  searchPlaceholder?: string
  emptyText?: string
}>(), {
  ariaLabel: '',
  maxVisible: 8,
  enableCollapse: true,
  searchPlaceholder: '',
  emptyText: ''
})
const { t } = useI18n()
const resolvedAriaLabel = computed(() => props.ariaLabel || t('common.filters.tabsAria'))
const resolvedSearchPlaceholder = computed(() => props.searchPlaceholder || t('common.filters.searchOptions'))
const resolvedEmptyText = computed(() => props.emptyText || t('common.filters.noOptions'))

const emit = defineEmits<{
  'update:modelValue': [value: string | number]
}>()

const popoverOpen = ref(false)
const popoverQuery = ref('')

function isActive(value: string | number) {
  return String(value) === String(props.modelValue)
}

function selectTab(value: string | number) {
  emit('update:modelValue', value)
}

const hasOverflow = computed(() => {
  return props.enableCollapse && props.tabs.length > props.maxVisible
})

const visibleTabs = computed(() => {
  if (!hasOverflow.value) {
    return props.tabs
  }

  const head = props.tabs.slice(0, props.maxVisible)
  const active = props.tabs.find(tab => isActive(tab.value))
  const hasActiveInHead = head.some(tab => isActive(tab.value))

  if (!active || hasActiveInHead || head.length === 0) {
    return head
  }

  if (head.length === 1) {
    return [active]
  }

  return [...head.slice(0, head.length - 1), active]
})

const hiddenCount = computed(() => {
  return Math.max(props.tabs.length - visibleTabs.value.length, 0)
})

const filteredPopoverTabs = computed(() => {
  const q = popoverQuery.value.trim().toLowerCase()
  if (!q) return props.tabs
  return props.tabs.filter(tab => String(tab.label).toLowerCase().includes(q))
})

watch(() => props.tabs, () => {
  popoverOpen.value = false
  popoverQuery.value = ''
})

function selectFromPopover(value: string | number) {
  selectTab(value)
  popoverOpen.value = false
  popoverQuery.value = ''
}
</script>

<template>
  <section
    :aria-label="resolvedAriaLabel"
    class="filter-tabs"
  >
    <div class="filter-tabs__list">
      <UButton
        v-for="tab in visibleTabs"
        :key="String(tab.value)"
        variant="ghost"
        color="neutral"
        size="sm"
        class="filter-tab cursor-pointer"
        :class="{ 'is-active': isActive(tab.value) }"
        :aria-pressed="isActive(tab.value)"
        :ui="{ label: 'truncate' }"
        @click="selectTab(tab.value)"
      >
        {{ tab.label }}
      </UButton>

      <UPopover
        v-if="hasOverflow"
        v-model:open="popoverOpen"
        :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
        :ui="{ content: 'w-72 p-0' }"
      >
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          class="filter-tab filter-tab--more cursor-pointer"
          trailing-icon="i-mdi-chevron-down"
        >
          {{ $t('common.filters.more', { count: hiddenCount }) }}
        </UButton>

        <template #content>
          <div class="filter-tabs-popover">
            <div class="filter-tabs-popover__head">
              <UInput
                v-model="popoverQuery"
                icon="i-mdi-magnify"
                color="neutral"
                variant="outline"
                size="sm"
                :placeholder="resolvedSearchPlaceholder"
                autocomplete="off"
                autofocus
              />
            </div>

            <div class="filter-tabs-popover__list">
              <button
                v-for="tab in filteredPopoverTabs"
                :key="String(tab.value)"
                type="button"
                class="design-button filter-tabs-option"
                :class="{ 'is-active': isActive(tab.value) }"
                :aria-pressed="isActive(tab.value)"
                @click="selectFromPopover(tab.value)"
              >
                <span class="truncate">{{ tab.label }}</span>
                <UIcon
                  v-if="isActive(tab.value)"
                  name="i-mdi-check"
                  class="size-4"
                />
              </button>

              <div
                v-if="filteredPopoverTabs.length === 0"
                class="filter-tabs-empty"
              >
                {{ resolvedEmptyText }}
              </div>
            </div>
          </div>
        </template>
      </UPopover>
    </div>
  </section>
</template>

<style scoped>
.filter-tabs {
  width: 100%;
}

.filter-tabs__list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
  padding: 4px;
  border: 1px solid color-mix(in srgb, var(--ui-border) 82%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--ui-bg-elevated) 64%, transparent);
}

.filter-tab {
  min-width: 0;
  height: 30px;
  max-width: 160px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding-inline: 10px;
  color: var(--ui-text-muted);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0;
  transition: box-shadow 180ms ease, background-color 180ms ease, color 180ms ease, border-color 180ms ease;
}

.filter-tab:hover {
  border-color: color-mix(in srgb, var(--ui-border) 72%, transparent);
  background: color-mix(in srgb, var(--ui-bg) 72%, transparent);
  color: var(--ui-text);
}

.filter-tab.is-active {
  border-color: color-mix(in srgb, var(--ui-border-accented) 72%, transparent);
  background: var(--ui-bg);
  color: var(--ui-text);
  box-shadow: 0 1px 2px color-mix(in srgb, black 8%, transparent);
}

.dark .filter-tab.is-active {
  background: color-mix(in srgb, var(--ui-bg-elevated) 88%, white 4%);
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 7%, transparent);
}

.filter-tab--more {
  margin-left: auto;
  color: var(--ui-text-muted);
}

.filter-tabs-popover {
  padding: 8px;
}

.filter-tabs-popover__head {
  padding-bottom: 8px;
  border-bottom: 1px solid var(--ui-border);
}

.filter-tabs-popover__list {
  display: grid;
  gap: 3px;
  max-height: 280px;
  overflow-y: auto;
  padding-top: 8px;
}

.filter-tabs-option {
  display: flex;
  min-width: 0;
  width: 100%;
  height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0 9px;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-align: left;
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
}

.filter-tabs-option:hover {
  border-color: color-mix(in srgb, var(--ui-border) 70%, transparent);
  background: color-mix(in srgb, var(--ui-bg-elevated) 70%, transparent);
  color: var(--ui-text);
}

.filter-tabs-option.is-active {
  background: color-mix(in srgb, var(--ui-primary) 9%, transparent);
  color: var(--ui-text);
}

.filter-tabs-empty {
  padding: 18px 8px;
  color: var(--ui-text-muted);
  font-size: 12px;
  text-align: center;
}
</style>
