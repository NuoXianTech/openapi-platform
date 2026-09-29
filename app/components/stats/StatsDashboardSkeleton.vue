<template>
  <div
    class="stats-dashboard-skeleton"
    role="status"
    :aria-label="$t('common.states.loading')"
  >
    <div
      class="stats-dashboard-skeleton__metrics"
      aria-hidden="true"
    >
      <UCard
        v-for="index in 8"
        :key="index"
        variant="outline"
        class="metric-skeleton"
        :ui="{ body: 'flex h-full flex-col !p-0 sm:!p-0' }"
      >
        <div class="metric-skeleton__content">
          <div class="min-w-0 flex-1">
            <USkeleton class="h-3 w-20" />
            <USkeleton class="mt-2.5 h-6 w-28" />
          </div>
          <USkeleton class="size-8 shrink-0 rounded-md" />
        </div>
        <div class="metric-skeleton__footer">
          <USkeleton class="h-3 w-32 max-w-full" />
        </div>
      </UCard>
    </div>

    <UCard
      variant="subtle"
      class="stats-skeleton-panel"
      :ui="{ body: 'p-4 sm:p-6', header: 'p-4 sm:p-6' }"
      aria-hidden="true"
    >
      <template #header>
        <div>
          <USkeleton class="h-5 w-36" />
          <USkeleton class="mt-2 h-3.5 w-64 max-w-full" />
        </div>
      </template>

      <dl class="trend-summary-skeleton">
        <div v-for="index in 3" :key="index">
          <dt><USkeleton class="h-3 w-16" /></dt>
          <dd><USkeleton class="h-5 w-24" /></dd>
        </div>
      </dl>

      <USkeleton class="h-[320px] w-full rounded-lg" />
      <div class="mt-4 flex gap-4">
        <USkeleton class="h-3 w-20" />
        <USkeleton class="h-3 w-20" />
      </div>
    </UCard>

    <UCard
      variant="subtle"
      class="stats-skeleton-panel"
      :ui="{ body: 'p-4 sm:p-6', header: 'p-4 sm:p-6' }"
      aria-hidden="true"
    >
      <template #header>
        <div>
          <USkeleton class="h-5 w-32" />
          <USkeleton class="mt-2 h-3.5 w-56 max-w-full" />
        </div>
      </template>

      <div class="ranking-skeleton">
        <div class="ranking-skeleton__header">
          <USkeleton class="h-3 w-4" />
          <USkeleton class="h-3 w-16" />
          <USkeleton class="ml-auto h-3 w-12" />
          <USkeleton class="ml-auto h-3 w-16" />
        </div>

        <ol>
          <li
            v-for="index in 10"
            :key="index"
            class="ranking-skeleton__row"
          >
            <USkeleton class="h-6 w-7 rounded-md" />
            <div class="min-w-0">
              <USkeleton class="h-3.5 w-36 max-w-full" />
              <USkeleton class="mt-2 h-3 w-24 max-w-full" />
            </div>
            <USkeleton class="ml-auto h-3.5 w-16" />
            <USkeleton class="ml-auto h-3.5 w-12" />
          </li>
        </ol>
      </div>
    </UCard>
  </div>
</template>

<style scoped>
.stats-dashboard-skeleton {
  display: grid;
  gap: 24px;
}

.stats-dashboard-skeleton__metrics {
  display: grid;
  gap: 16px;
}

.metric-skeleton,
.stats-skeleton-panel {
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  box-shadow: none;
}

.metric-skeleton__content {
  display: flex;
  min-height: 108px;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 20px;
}

.metric-skeleton__footer {
  display: flex;
  min-height: 44px;
  align-items: center;
  border-top: 1px solid var(--ui-border-muted);
  padding-inline: 20px;
}

.trend-summary-skeleton {
  display: grid;
  margin-bottom: 1rem;
  border-block: 1px solid var(--ui-border-muted);
}

.trend-summary-skeleton > div {
  min-width: 0;
  padding-block: 0.75rem;
}

.trend-summary-skeleton > div + div {
  border-top: 1px solid var(--ui-border-muted);
}

.trend-summary-skeleton dd {
  margin-top: 0.5rem;
}

.ranking-skeleton__header,
.ranking-skeleton__row {
  grid-template-columns: 3rem minmax(0, 1fr) 7rem 6rem;
  align-items: center;
  column-gap: 0.75rem;
}

.ranking-skeleton__header {
  display: none;
  padding-bottom: 0.625rem;
  border-bottom: 1px solid var(--ui-border);
}

.ranking-skeleton__row {
  display: grid;
  padding-block: 0.75rem;
  border-top: 1px solid var(--ui-border);
}

.ranking-skeleton__row:first-child {
  border-top: 0;
}

.ranking-skeleton__row:last-child {
  padding-bottom: 0;
}

@media (min-width: 640px) {
  .stats-dashboard-skeleton__metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .metric-skeleton__content {
    padding: 24px;
  }

  .metric-skeleton__footer {
    padding-inline: 24px;
  }

  .trend-summary-skeleton {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .trend-summary-skeleton > div {
    padding-inline: 1rem;
  }

  .trend-summary-skeleton > div:first-child {
    padding-left: 0;
  }

  .trend-summary-skeleton > div:last-child {
    padding-right: 0;
  }

  .trend-summary-skeleton > div + div {
    border-top: 0;
    border-left: 1px solid var(--ui-border-muted);
  }

  .ranking-skeleton__header {
    display: grid;
  }
}

@media (min-width: 1024px) {
  .stats-dashboard-skeleton__metrics {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}

@media (max-width: 639px) {
  .ranking-skeleton__row {
    grid-template-columns: auto minmax(0, 1fr);
    row-gap: 0.5rem;
  }

  .ranking-skeleton__row > :nth-child(3),
  .ranking-skeleton__row > :nth-child(4) {
    grid-column: 2;
    margin-left: 0;
  }
}
</style>
