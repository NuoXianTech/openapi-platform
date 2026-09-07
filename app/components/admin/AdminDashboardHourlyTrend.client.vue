<script setup lang="ts">
import { VisXYContainer, VisArea, VisLine, VisAxis, VisCrosshair, VisTooltip } from '@unovis/vue'
import type { AdminDashboardHourlyPoint } from '#shared/types/admin'
import { formatDateTime, formatTrendHour } from '~/utils/datetime'

// 本组件是 .client.vue（@unovis 的 d3+DOM 不进 admin 首屏 entry）。
// unovis 原语必须静态导入、同步可用——各自 defineAsyncComponent 会让 VisXYContainer 在
// VisAxis 注册前就首绘，导致坐标轴首帧画不出来（须点刷新才补画）。

interface Props {
  trend: AdminDashboardHourlyPoint[]
}

const props = defineProps<Props>()
const { t, locale } = useI18n()

const rootRef = useTemplateRef<HTMLElement | null>('rootRef')
const { width } = useElementSize(rootRef)

const MINIMUM_CHART_WIDTH = 960
const chartWidth = computed(() => Math.max(width.value, MINIMUM_CHART_WIDTH))

interface TrendRow {
  timestamp: number
  totalCalls: number
}

const rows = computed<TrendRow[]>(() => props.trend.map(p => ({
  timestamp: new Date(p.hour).getTime(),
  totalCalls: p.totalCalls
})))

const hasData = computed(() => rows.value.some(r => r.totalCalls > 0))

const HOUR_MS = 60 * 60 * 1000
const x = (d: TrendRow) => d.timestamp
const yAccessor = (d: TrendRow) => d.totalCalls
const xDomain = computed<[number, number]>(() => [
  (rows.value[0]?.timestamp ?? HOUR_MS) - HOUR_MS,
  rows.value.at(-1)?.timestamp ?? HOUR_MS
])
// Include both window boundaries, with one label every two hours for readability.
const xTickValues = computed(() => [
  xDomain.value[0],
  ...rows.value.filter((_row, index) => index % 2 === 1).map(row => row.timestamp)
])
const xTickFormat = (tick: number | Date) => formatTrendHour(tick, locale.value)
const yTickFormat = formatChartIntegerTick

const tooltipTemplate = (d: TrendRow) => renderChartTooltip({
  title: `${formatDateTime(d.timestamp - HOUR_MS, '-', locale.value)} – ${formatDateTime(d.timestamp, '-', locale.value)}`,
  rows: [
    { color: 'var(--ui-info)', label: t('admin.overview.hourly.calls'), value: d.totalCalls.toLocaleString(locale.value) }
  ]
})
</script>

<template>
  <div
    ref="rootRef"
    class="relative"
  >
    <UEmpty
      v-if="!hasData"
      icon="i-mdi-clock-time-eight-outline"
      :title="$t('admin.overview.hourly.empty')"
      variant="naked"
      class="h-64"
    />

    <div
      v-else
      class="overflow-x-auto"
    >
      <VisXYContainer
        :data="rows"
        :x-domain="xDomain"
        :padding="{ top: 20, right: 16, bottom: 28, left: 8 }"
        :width="chartWidth"
        class="h-64 min-w-[960px]"
      >
        <VisArea
          :x="x"
          :y="yAccessor"
          color="var(--ui-info)"
          :opacity="0.15"
        />
        <VisLine
          :x="x"
          :y="yAccessor"
          color="var(--ui-info)"
          :line-width="2.2"
        />
        <VisAxis
          type="x"
          :tick-line="false"
          :domain-line="false"
          :grid-line="false"
          :tick-format="xTickFormat"
          :tick-values="xTickValues"
        />
        <VisAxis
          type="y"
          :tick-line="false"
          :domain-line="false"
          :grid-line="true"
          :tick-format="yTickFormat"
          :num-ticks="4"
        />
        <VisCrosshair
          color="var(--ui-info)"
          :template="tooltipTemplate"
        />
        <VisTooltip />
      </VisXYContainer>
    </div>
  </div>
</template>
