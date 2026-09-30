<script setup lang="ts">
import type { DashboardMetricTone } from '~/types/dashboard-metric'

const metricToneClasses: Record<DashboardMetricTone, string> = {
  ink: 'is-ink',
  blue: 'is-blue',
  violet: 'is-violet',
  bronze: 'is-bronze',
  rose: 'is-rose'
}

interface DashboardMetricCardProps {
  label: string
  value: string
  icon: string
  unit?: string
  meta?: string
  tone?: DashboardMetricTone
  compact?: boolean
  sparklineValues?: number[]
}

interface SparklinePathState {
  linePath: string
  areaPath: string
  allZero: boolean
}

const props = withDefaults(defineProps<DashboardMetricCardProps>(), {
  unit: undefined,
  meta: undefined,
  tone: 'ink',
  compact: false,
  sparklineValues: undefined
})

const slots = useSlots()
const hasFooter = computed(() => Boolean(
  slots.footer
  || props.meta
  || props.sparklineValues?.length
))
const contentClass = computed(() => [
  'dashboard-metric-card__content relative z-10 flex flex-1 flex-col',
  props.compact ? 'gap-1 p-3 sm:p-4' : 'gap-1 p-4 sm:p-5'
])
const footerClass = computed(() => [
  'dashboard-metric-card__footer relative z-10',
  props.compact ? 'px-3 py-2 sm:px-4' : 'px-4 py-2.5 sm:px-5'
])
const valueClass = computed(() => props.compact
  ? 'dashboard-metric-card-value text-xl font-semibold tabular-nums text-highlighted'
  : 'dashboard-metric-card-value text-2xl font-semibold tabular-nums text-highlighted')
const iconClass = computed(() => props.compact
  ? 'dashboard-metric-card-icon flex size-8 shrink-0 items-center justify-center rounded-md'
  : 'dashboard-metric-card-icon flex size-9 shrink-0 items-center justify-center rounded-md')
const sparklineHeight = computed(() => props.compact ? 36 : SPARKLINE_HEIGHT)

const SPARKLINE_VIEW_W = 200
const SPARKLINE_VIEW_H = 60
const SPARKLINE_PAD = 4
const SPARKLINE_HEIGHT = 48

function buildSparklinePath(values: number[]): SparklinePathState {
  const vals = values.length ? values : [0, 0]
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1

  const usableW = SPARKLINE_VIEW_W - SPARKLINE_PAD * 2
  const usableH = SPARKLINE_VIEW_H - SPARKLINE_PAD * 2
  const step = vals.length > 1 ? usableW / (vals.length - 1) : 0

  const points = vals.map((value, index) => {
    const x = SPARKLINE_PAD + step * index
    const y = SPARKLINE_PAD + (1 - (value - min) / range) * usableH
    return { x, y }
  })

  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  const lastX = points[points.length - 1]?.x ?? SPARKLINE_PAD
  const firstX = points[0]?.x ?? SPARKLINE_PAD
  const areaPath = `${linePath} L${lastX.toFixed(2)},${SPARKLINE_VIEW_H - SPARKLINE_PAD} L${firstX.toFixed(2)},${SPARKLINE_VIEW_H - SPARKLINE_PAD} Z`

  return { linePath, areaPath, allZero: max === min && max === 0 }
}

const sparkline = computed(() => buildSparklinePath(props.sparklineValues ?? []))
</script>

<template>
  <UCard
    variant="outline"
    class="dashboard-metric-card"
    :class="[metricToneClasses[props.tone], { 'is-compact': props.compact }]"
    :ui="{
      root: 'h-full',
      body: 'flex h-full flex-col !p-0 sm:!p-0'
    }"
  >
    <div :class="contentClass">
      <div class="flex min-w-0 items-center justify-between gap-3">
        <p class="dashboard-metric-card__label min-w-0 truncate text-xs font-medium text-muted">
          {{ label }}
        </p>

        <div :class="iconClass">
          <UIcon
            :name="icon"
            class="size-4.5"
          />
        </div>
      </div>

      <div class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0">
        <span :class="valueClass">
          {{ value }}
        </span>
        <span
          v-if="unit"
          class="min-w-0 text-xs font-medium text-muted wrap-anywhere"
        >
          {{ unit }}
        </span>
      </div>
    </div>

    <div
      v-if="hasFooter"
      :class="footerClass"
    >
      <slot name="footer">
        <svg
          v-if="sparklineValues?.length"
          :viewBox="`0 0 ${SPARKLINE_VIEW_W} ${SPARKLINE_VIEW_H}`"
          preserveAspectRatio="none"
          :style="{ height: `${sparklineHeight}px`, width: '100%' }"
          class="dashboard-metric-card__sparkline block overflow-visible"
          aria-hidden="true"
        >
          <line
            v-if="sparkline.allZero"
            :x1="SPARKLINE_PAD"
            :x2="SPARKLINE_VIEW_W - SPARKLINE_PAD"
            :y1="SPARKLINE_VIEW_H / 2"
            :y2="SPARKLINE_VIEW_H / 2"
            stroke="var(--dashboard-metric-accent)"
            stroke-width="1.5"
            stroke-dasharray="3 4"
            opacity="0.5"
            vector-effect="non-scaling-stroke"
          />
          <template v-else>
            <path
              :d="sparkline.areaPath"
              fill="var(--dashboard-metric-accent)"
              opacity="0.12"
            />
            <path
              :d="sparkline.linePath"
              fill="none"
              stroke="var(--dashboard-metric-accent)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              vector-effect="non-scaling-stroke"
            />
          </template>
        </svg>
        <p
          v-else-if="meta"
          class="dashboard-metric-card-meta truncate text-xs text-muted"
        >
          {{ meta }}
        </p>
      </slot>
    </div>
  </UCard>
</template>

<style scoped>
.dashboard-metric-card {
  --dashboard-metric-accent: var(--ui-text-toned);
  min-width: 0;
  border-color: var(--dashboard-border);
  background: var(--dashboard-surface);
  box-shadow:
    var(--dashboard-shadow),
    0 18px 34px -34px color-mix(in oklab, var(--ui-text) 38%, transparent);
}

.dashboard-metric-card.is-blue { --dashboard-metric-accent: var(--dashboard-accent-blue); }
.dashboard-metric-card.is-violet { --dashboard-metric-accent: var(--dashboard-accent-violet); }
.dashboard-metric-card.is-bronze { --dashboard-metric-accent: var(--dashboard-accent-bronze); }
.dashboard-metric-card.is-rose { --dashboard-metric-accent: var(--dashboard-accent-rose); }

.dashboard-metric-card__content {
  min-height: 6.75rem;
}

.dashboard-metric-card.is-compact .dashboard-metric-card__content {
  min-height: 5.5rem;
}

.dashboard-metric-card__label {
  letter-spacing: 0.01em;
}

.dashboard-metric-card-icon {
  color: var(--dashboard-metric-accent);
  border: 1px solid color-mix(in oklab, var(--dashboard-metric-accent) 24%, var(--ui-border));
  background: color-mix(in oklab, var(--dashboard-metric-accent) 8%, var(--ui-bg-elevated));
  box-shadow: inset 0 1px 0 color-mix(in oklab, white 46%, transparent);
}

.dashboard-metric-card-value {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  letter-spacing: 0;
}

.dashboard-metric-card-meta {
  line-height: 1.5;
}

.dashboard-metric-card__footer {
  min-height: 2.5rem;
  margin-top: auto;
  border-top: 1px solid color-mix(in oklab, var(--ui-border-muted) 78%, transparent);
  background: linear-gradient(
    90deg,
    color-mix(in oklab, var(--dashboard-metric-accent) 3%, var(--dashboard-surface-muted)),
    color-mix(in oklab, var(--dashboard-surface-muted) 68%, var(--dashboard-surface))
  );
}

.dashboard-metric-card__sparkline {
  filter: saturate(0.86);
}

.dark .dashboard-metric-card-icon {
  box-shadow: inset 0 1px 0 color-mix(in oklab, white 8%, transparent);
}
</style>
