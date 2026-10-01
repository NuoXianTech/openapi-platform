<script setup lang="ts">
interface DashboardTableCardProps {
  title: string
  icon?: string
  description?: string
  total?: number
  embedded?: boolean
}

const props = withDefaults(defineProps<DashboardTableCardProps>(), {
  icon: undefined,
  description: undefined,
  total: undefined,
  embedded: false
})
const { t, locale } = useI18n()

const totalText = computed(() => {
  if (props.total === undefined) return undefined
  return t('common.pagination.totalRecords', { count: props.total.toLocaleString(locale.value) })
})
</script>

<template>
  <UCard
    v-if="!embedded"
    class="dashboard-table-card overflow-hidden"
    variant="subtle"
    :ui="{ body: 'p-0 sm:p-0' }"
  >
    <template #header>
      <div class="flex flex-wrap items-center gap-2.5">
        <div class="flex min-w-0 items-center gap-2">
          <UIcon
            v-if="icon"
            :name="icon"
            class="size-4.5 shrink-0 text-muted"
          />
          <div class="min-w-0">
            <h3 class="design-heading-md text-highlighted">
              {{ title }}
            </h3>
            <p
              v-if="description"
              class="mt-1 text-sm leading-5 text-muted"
            >
              {{ description }}
            </p>
          </div>
        </div>
        <div
          v-if="totalText || $slots.actions"
          class="ml-auto flex items-center gap-2"
        >
          <span
            v-if="totalText"
            class="text-xs text-muted tabular-nums"
          >
            {{ totalText }}
          </span>
          <slot name="actions" />
        </div>
      </div>
    </template>

    <slot />
  </UCard>

  <div
    v-else
    class="dashboard-table-card-embedded"
  >
    <div class="flex flex-wrap items-center gap-2.5 px-0 pb-2.5">
      <div class="flex min-w-0 items-center gap-2">
        <UIcon
          v-if="icon"
          :name="icon"
          class="size-4.5 shrink-0 text-muted"
        />
        <div class="min-w-0">
          <h3 class="design-heading-md text-highlighted">
            {{ title }}
          </h3>
          <p
            v-if="description"
            class="mt-1 text-sm leading-5 text-muted"
          >
            {{ description }}
          </p>
        </div>
      </div>
      <div
        v-if="totalText || $slots.actions"
        class="ml-auto flex items-center gap-2"
      >
        <span
          v-if="totalText"
          class="text-xs text-muted tabular-nums"
        >
          {{ totalText }}
        </span>
        <slot name="actions" />
      </div>
    </div>

    <slot />
  </div>
</template>
