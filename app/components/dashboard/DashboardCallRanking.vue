<script setup lang="ts">
import type { DashboardCallRankItem } from '#shared/types/dashboard'

interface Props {
  ranking: DashboardCallRankItem[]
}

defineProps<Props>()

const { t, locale } = useI18n()
const formatCount = (val: number) => val.toLocaleString(locale.value)
const formatRate = (val: number) => `${val.toFixed(2)}%`
</script>

<template>
  <UEmpty
    v-if="ranking.length === 0"
    icon="i-mdi-trophy-outline"
    :title="t('common.dashboardRanking.empty')"
    variant="naked"
    class="h-64"
  />

  <div
    v-else
    class="rank-table"
  >
    <div class="rank-header hidden sm:grid">
      <span>#</span>
      <span>{{ $t('common.dashboardRanking.api') }}</span>
      <span class="text-right">{{ $t('common.dashboardRanking.calls') }}</span>
      <span class="text-right">{{ $t('common.dashboardRanking.successRate') }}</span>
    </div>

    <ol>
      <li
        v-for="item in ranking"
        :key="item.routeId"
        class="rank-row"
      >
        <UBadge
          :color="item.rank <= 3 ? 'primary' : 'neutral'"
          :variant="item.rank <= 3 ? 'solid' : 'soft'"
          class="w-7 justify-center rounded-md tabular-nums"
        >
          {{ item.rank }}
        </UBadge>

        <div class="min-w-0 flex-1">
          <UTooltip
            :text="item.name"
            :content="{ side: 'top' }"
          >
            <div class="truncate text-sm font-medium text-default">
              {{ item.name }}
            </div>
          </UTooltip>
          <UTooltip
            :text="item.apiPath"
            :content="{ side: 'top' }"
          >
            <div class="truncate font-mono text-xs text-muted">
              {{ item.apiPath }}
            </div>
          </UTooltip>
        </div>

        <div class="text-right text-sm font-semibold tabular-nums text-highlighted">
          {{ formatCount(item.totalCalls) }}
          <span class="ml-0.5 text-xs font-normal text-muted">{{ $t('common.dashboardRanking.times') }}</span>
        </div>

        <div class="text-right text-sm tabular-nums text-muted">
          {{ formatRate(item.successRate) }}
        </div>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.rank-table {
  min-width: 0;
}

.rank-header,
.rank-row {
  grid-template-columns: 3rem minmax(0, 1fr) 7rem 6rem;
  align-items: center;
  column-gap: 0.75rem;
}

.rank-header {
  padding-bottom: 0.625rem;
  font-size: 0.75rem;
  color: var(--ui-text-muted);
  border-bottom: 1px solid var(--ui-border);
}

.rank-row {
  display: grid;
  padding: 0.75rem 0;
  border-top: 1px solid var(--ui-border);
}

.rank-header + ol .rank-row:first-child {
  border-top: 0;
}

.rank-row:last-child {
  padding-bottom: 0;
}

@media (max-width: 639px) {
  .rank-row {
    grid-template-columns: auto minmax(0, 1fr);
    row-gap: 0.5rem;
  }

  .rank-row > :nth-child(3),
  .rank-row > :nth-child(4) {
    grid-column: 2;
  }

  .rank-row > :nth-child(3) {
    text-align: left;
  }

  .rank-row > :nth-child(4) {
    text-align: left;
  }
}
</style>
