<script setup lang="ts">
import { CalendarDate, getLocalTimeZone, parseDate, today, type DateValue } from '@internationalized/date'
import type { UserCheckinCalendarMonth } from '#shared/types/user-credits'

interface UserCreditsCheckinCalendarProps {
  history: UserCheckinCalendarMonth | null
  loading: boolean
  onMonthChange: (month: string) => Promise<unknown>
}

const props = defineProps<UserCreditsCheckinCalendarProps>()
const { locale } = useI18n()

const todayDate = today(getLocalTimeZone())
const placeholder = shallowRef<DateValue>(new CalendarDate(todayDate.year, todayDate.month, 1))

const visibleMonth = computed(() => toMonthKey(placeholder.value))
const hasVisibleHistory = computed(() => props.history?.month === visibleMonth.value)
const checkedDates = computed<DateValue[]>(() =>
  hasVisibleHistory.value
    ? (props.history?.days ?? []).map(day => parseDate(day.date))
    : []
)
const checkedDayCount = computed(() => hasVisibleHistory.value ? props.history?.checkedDayCount ?? 0 : 0)
const totalAmount = computed(() => hasVisibleHistory.value ? props.history?.totalAmount ?? 0 : 0)

onMounted(() => {
  void props.onMonthChange(visibleMonth.value)
})

watch(visibleMonth, (month, previousMonth) => {
  if (month === previousMonth) return
  void props.onMonthChange(month)
})

function toMonthKey(date: DateValue): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}`
}
</script>

<template>
  <DashboardContentCard
    :title="$t('user.credits.calendar.title')"
    :description="$t('user.credits.calendar.description')"
    icon="i-mdi-calendar-month-outline"
  >
    <template #actions>
      <span
        v-if="loading"
        class="inline-flex items-center gap-1.5 text-xs text-muted"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 animate-spin"
        />
        {{ $t('common.states.loading') }}
      </span>
    </template>

    <div class="grid grid-cols-2 divide-x divide-default border-b border-default pb-4">
      <div class="min-w-0 pe-3 sm:pe-4">
        <p class="text-xs font-medium text-muted">
          {{ $t('user.credits.calendar.earnedThisMonth') }}
        </p>
        <p class="mt-1.5 text-lg font-semibold text-success tabular-nums wrap-anywhere">
          <template v-if="hasVisibleHistory">
            {{ $t('user.credits.calendar.points', { amount: totalAmount.toLocaleString(locale) }) }}
          </template>
          <template v-else>
            —
          </template>
        </p>
      </div>

      <div class="min-w-0 ps-3 sm:ps-4">
        <p class="text-xs font-medium text-muted">
          {{ $t('user.credits.calendar.checkinsThisMonth') }}
        </p>
        <p class="mt-1.5 text-lg font-semibold text-highlighted tabular-nums wrap-anywhere">
          <template v-if="hasVisibleHistory">
            {{ $t('user.credits.calendar.days', { count: checkedDayCount.toLocaleString(locale) }) }}
          </template>
          <template v-else>
            —
          </template>
        </p>
      </div>
    </div>

    <UCalendar
      v-model:placeholder="placeholder"
      multiple
      readonly
      fixed-weeks
      disable-days-outside-current-view
      color="success"
      variant="subtle"
      size="md"
      :locale="locale"
      :model-value="checkedDates"
      :max-value="todayDate"
      :view-control="false"
      :ui="{
        cell: 'min-w-0 w-full',
        cellTrigger: 'mx-auto my-0.5 aspect-square h-auto w-[calc(100%-0.25rem)] max-w-10'
      }"
      class="mx-auto mt-4 w-full max-w-sm"
    />

    <div class="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-default pt-3 text-xs text-muted">
      <span class="inline-flex items-center gap-1.5">
        <span class="size-3 rounded-full bg-success/15 ring-1 ring-success/30" />
        {{ $t('user.credits.calendar.checkedIn') }}
      </span>
      <span class="inline-flex items-center gap-1.5">
        <span class="text-sm font-semibold text-success">{{ todayDate.day }}</span>
        {{ $t('user.credits.calendar.today') }}
      </span>
    </div>
  </DashboardContentCard>
</template>
