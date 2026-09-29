<script setup lang="ts">
import { VisXYContainer, VisArea, VisLine, VisAxis, VisCrosshair, VisTooltip } from '@unovis/vue'
import type { PublicCallStatsTrendPoint } from '#shared/types/public-stats'

// 本组件是 .client.vue（仅客户端打包，@unovis 的 d3+DOM 不进首屏 entry）。
// 注意：unovis 原语必须静态导入、同步可用——若各自用 defineAsyncComponent 异步加载，
// VisXYContainer 可能在 VisAxis 解析注册前就完成首次绘制，导致坐标轴首帧画不出来，
// 只有后续一次数据 update 才补画（即「点刷新才出现坐标轴」的根因）。

interface Props {
  trend: PublicCallStatsTrendPoint[]
}

const props = defineProps<Props>()
const { t, locale } = useI18n()

// 把容器宽度响应式地喂给 VisXYContainer（官方仪表盘模板同款）：
// unovis 首次挂载时内部测得的宽度可能为 0、不绘制坐标轴，必须等一次尺寸变化才补画。
// useElementSize 在元素测量后由 0 更新为真实宽度，这次变更即驱动 unovis 重绘画出刻度。
const rootRef = useTemplateRef<HTMLElement | null>('rootRef')
const { width } = useElementSize(rootRef)

interface TrendRow {
  label: string
  fullLabel: string
  success: number
  failure: number
}

const rows = computed<TrendRow[]>(() => props.trend.map(item => ({
  label: formatTrendShortDate(item.date),
  fullLabel: formatTrendFullDate(item.date, locale.value),
  success: item.successCalls,
  failure: item.failureCalls
})))

const hasData = computed(() => rows.value.some(row => row.success + row.failure > 0))

const formatCount = (value: number) => value.toLocaleString(locale.value)

const x = (_row: TrendRow, index: number) => index
const successAccessor = (row: TrendRow) => row.success
const failureAccessor = (row: TrendRow) => row.failure

// 准星圆点配色，按 y 访问器顺序对应成功 / 失败
const crosshairColors = ['var(--ui-text-highlighted)', 'var(--ui-error)'] as const
const xTickFormat = createChartIndexedTickFormatter(() => rows.value, row => row.label)
const yTickFormat = formatChartIntegerTick

// 走全站统一的卡片式 tooltip 渲染器（utils/chart-tooltip.ts），与 admin 管理概览同款
function tooltipTemplate(datum: TrendRow | undefined) {
  if (!datum) {
    return ''
  }
  const total = datum.success + datum.failure
  const rate = total > 0 ? `${((datum.success / total) * 100).toFixed(1)}%` : '--'
  return renderChartTooltip({
    title: datum.fullLabel,
    rows: [
      { color: 'var(--ui-text-highlighted)', label: t('public.stats.chart.success'), value: formatCount(datum.success) },
      { color: 'var(--ui-error)', label: t('public.stats.chart.failure'), value: formatCount(datum.failure) }
    ],
    footer: [
      { label: t('public.stats.chart.total'), value: formatCount(total) },
      { label: t('public.stats.chart.successRate'), value: rate }
    ]
  })
}
</script>

<template>
  <div
    ref="rootRef"
    class="relative"
  >
    <UEmpty
      v-if="!hasData"
      icon="i-mdi-chart-line"
      :title="t('public.stats.chart.emptyTitle')"
      :description="t('public.stats.chart.emptyDescription')"
      variant="naked"
      class="h-[320px]"
    />

    <template v-else>
      <VisXYContainer
        :data="rows"
        :padding="{ left: 8, right: 16, top: 20, bottom: 28 }"
        :width="width"
        class="h-[320px] w-full"
      >
        <VisArea
          :x="x"
          :y="successAccessor"
          color="var(--ui-text-highlighted)"
          :opacity="0.06"
        />
        <VisLine
          :x="x"
          :y="successAccessor"
          color="var(--ui-text-highlighted)"
          :line-width="2"
        />
        <VisLine
          :x="x"
          :y="failureAccessor"
          color="var(--ui-error)"
          :line-width="2"
        />
        <VisAxis
          type="y"
          :tick-line="false"
          :domain-line="false"
          :grid-line="true"
          :tick-format="yTickFormat"
        />
        <VisAxis
          type="x"
          :tick-line="false"
          :domain-line="false"
          :grid-line="false"
          :tick-format="xTickFormat"
          :num-ticks="7"
        />
        <VisCrosshair
          :x="x"
          :y="[successAccessor, failureAccessor]"
          :color="crosshairColors"
          :template="tooltipTemplate"
        />
        <VisTooltip />
      </VisXYContainer>

      <div class="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2 rounded-full bg-primary" />
          {{ $t('public.stats.chart.successCount') }}
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="size-2 rounded-full bg-error" />
          {{ $t('public.stats.chart.failureCount') }}
        </span>
      </div>
    </template>
  </div>
</template>
