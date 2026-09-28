<script setup lang="ts">
import type { AdminDashboardDistributionItem } from '#shared/types/admin'

interface Props {
  distribution: AdminDashboardDistributionItem[]
  loading?: boolean
}

const props = withDefaults(defineProps<Props>(), { loading: false })
const { locale } = useI18n()

const totalCalls = computed(() => props.distribution.reduce((sum, item) => sum + item.totalCalls, 0))

const rows = computed(() => {
  if (totalCalls.value === 0) return []
  const max = Math.max(...props.distribution.map(d => d.totalCalls), 1)
  return props.distribution.map(item => ({
    ...item,
    percent: (item.totalCalls / totalCalls.value) * 100,
    width: (item.totalCalls / max) * 100
  }))
})

const formatNumber = (val: number) => val.toLocaleString(locale.value)
</script>

<template>
  <div>
    <div
      v-if="rows.length === 0"
      class="flex h-56 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted"
    >
      {{ $t('admin.overview.distribution.empty') }}
    </div>

    <ul
      v-else
      class="space-y-3"
    >
      <li
        v-for="item in rows"
        :key="item.routeId"
        class="space-y-1.5"
      >
        <div class="flex items-baseline justify-between gap-3 text-sm">
          <UTooltip
            :text="item.name"
            :content="{ side: 'top' }"
          >
            <span class="truncate font-medium">
              {{ item.name }}
            </span>
          </UTooltip>
          <span class="shrink-0 text-xs tabular-nums text-muted">
            {{ formatNumber(item.totalCalls) }}
            <span class="ml-1 text-xs">{{ item.percent.toFixed(1) }}%</span>
          </span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
          <div
            class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
            :style="{ width: `${item.width}%` }"
          />
        </div>
        <UTooltip
          v-if="item.apiPath"
          :text="item.apiPath"
          :content="{ side: 'top' }"
        >
          <div class="truncate text-xs font-mono text-muted">
            {{ item.apiPath }}
          </div>
        </UTooltip>
      </li>
    </ul>
  </div>
</template>
