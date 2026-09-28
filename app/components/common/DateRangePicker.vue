<script setup lang="ts">
import {
  CalendarDate,
  CalendarDateTime,
  DateFormatter,
  getLocalTimeZone,
  Time,
  today
} from '@internationalized/date'
import { useMediaQuery } from '@vueuse/core'

const props = withDefaults(defineProps<{
  placeholder?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  disabled?: boolean
  clearable?: boolean
  icon?: string
  block?: boolean
}>(), {
  placeholder: '',
  size: 'md',
  disabled: false,
  clearable: true,
  icon: 'i-mdi-calendar-range-outline',
  block: true
})

const emit = defineEmits<{
  apply: []
}>()

const start = defineModel<string>('start', { default: '' })
const end = defineModel<string>('end', { default: '' })
const { t, locale } = useI18n()
const resolvedPlaceholder = computed(() => props.placeholder || t('common.dateTime.selectRange'))

const open = ref(false)
const timeZone = getLocalTimeZone()
const showTwoMonths = useMediaQuery('(min-width: 640px)')

const dateFormatter = computed(() => new DateFormatter(locale.value, {
  year: 'numeric',
  month: 'short',
  day: 'numeric'
}))
const dateTimeFormatter = computed(() => new DateFormatter(locale.value, {
  dateStyle: 'medium',
  timeStyle: 'short'
}))
const timeFormatter = computed(() => new DateFormatter(locale.value, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
}))

const draftStartDate = ref<CalendarDate>()
const draftStartTime = ref<Time>()
const draftEndDate = ref<CalendarDate>()
const draftEndTime = ref<Time>()

function syncDraft() {
  const startValue = dateTimeLocalToCalendar(start.value)
  const endValue = dateTimeLocalToCalendar(end.value)

  draftStartDate.value = startValue
    ? new CalendarDate(startValue.year, startValue.month, startValue.day)
    : undefined
  draftStartTime.value = startValue
    ? new Time(startValue.hour, startValue.minute)
    : undefined
  draftEndDate.value = endValue
    ? new CalendarDate(endValue.year, endValue.month, endValue.day)
    : undefined
  draftEndTime.value = endValue
    ? new Time(endValue.hour, endValue.minute)
    : undefined
}

watch([start, end], () => {
  if (!open.value) syncDraft()
}, { immediate: true })

watch(open, (isOpen) => {
  if (isOpen) syncDraft()
})

function toDateTime(
  date: CalendarDate | undefined,
  time: Time | undefined,
  fallbackTime: Time
): CalendarDateTime | undefined {
  if (!date) return undefined
  const resolvedTime = time ?? fallbackTime
  return new CalendarDateTime(
    date.year,
    date.month,
    date.day,
    resolvedTime.hour,
    resolvedTime.minute
  )
}

const rangeProxy = computed({
  get: () => ({ start: draftStartDate.value, end: draftEndDate.value }),
  set: (range: { start: CalendarDate | null, end: CalendarDate | null }) => {
    draftStartDate.value = range.start ?? undefined
    draftEndDate.value = range.end ?? undefined

    if (range.start && !draftStartTime.value) draftStartTime.value = new Time(0, 0)
    if (range.end && !draftEndTime.value) draftEndTime.value = new Time(23, 59)
    if (!range.start) draftStartTime.value = undefined
    if (!range.end) draftEndTime.value = undefined
  }
})

const startTimeProxy = computed({
  get: () => draftStartTime.value ?? new Time(0, 0),
  set: (value: Time) => {
    draftStartTime.value = value
  }
})

const endTimeProxy = computed({
  get: () => draftEndTime.value ?? new Time(23, 59),
  set: (value: Time) => {
    draftEndTime.value = value
  }
})

const hasDraftValue = computed(() => Boolean(draftStartDate.value || draftEndDate.value))
const canApply = computed(() => {
  if (!draftStartDate.value || !draftEndDate.value) return true

  const startValue = toDateTime(draftStartDate.value, draftStartTime.value, new Time(0, 0))
  const endValue = toDateTime(draftEndDate.value, draftEndTime.value, new Time(23, 59))
  return Boolean(startValue && endValue && startValue.compare(endValue) <= 0)
})

const displayLabel = computed(() => {
  const startValue = dateTimeLocalToCalendar(start.value)
  const endValue = dateTimeLocalToCalendar(end.value)
  if (!startValue) {
    return endValue
      ? `≤ ${dateTimeFormatter.value.format(endValue.toDate(timeZone))}`
      : ''
  }
  if (!endValue) return `≥ ${dateTimeFormatter.value.format(startValue.toDate(timeZone))}`

  const startDate = startValue.toDate(timeZone)
  const endDate = endValue.toDate(timeZone)
  const sameDay = startValue.year === endValue.year
    && startValue.month === endValue.month
    && startValue.day === endValue.day
  const coversWholeDays = startValue.hour === 0
    && startValue.minute === 0
    && endValue.hour === 23
    && endValue.minute === 59

  if (coversWholeDays) {
    const startText = dateFormatter.value.format(startDate)
    return sameDay
      ? startText
      : `${startText} – ${dateFormatter.value.format(endDate)}`
  }

  if (sameDay) {
    return `${dateFormatter.value.format(startDate)} · ${timeFormatter.value.format(startDate)}–${timeFormatter.value.format(endDate)}`
  }

  return `${dateTimeFormatter.value.format(startDate)} – ${dateTimeFormatter.value.format(endDate)}`
})

interface RangePreset {
  label: string
  days?: number
  months?: number
  years?: number
}

const presets = computed<RangePreset[]>(() => [
  { label: t('common.dateTime.presets.last7Days'), days: 7 },
  { label: t('common.dateTime.presets.last14Days'), days: 14 },
  { label: t('common.dateTime.presets.last30Days'), days: 30 },
  { label: t('common.dateTime.presets.last3Months'), months: 3 },
  { label: t('common.dateTime.presets.last6Months'), months: 6 },
  { label: t('common.dateTime.presets.lastYear'), years: 1 }
])

function presetStart(preset: RangePreset) {
  const currentDate = today(timeZone)
  if (preset.days) return currentDate.subtract({ days: preset.days - 1 })
  if (preset.months) return currentDate.subtract({ months: preset.months })
  if (preset.years) return currentDate.subtract({ years: preset.years })
  return currentDate
}

function isPresetActive(preset: RangePreset) {
  if (!draftStartDate.value || !draftEndDate.value) return false
  return draftStartDate.value.compare(presetStart(preset)) === 0
    && draftEndDate.value.compare(today(timeZone)) === 0
    && draftStartTime.value?.hour === 0
    && draftStartTime.value?.minute === 0
    && draftEndTime.value?.hour === 23
    && draftEndTime.value?.minute === 59
}

function selectPreset(preset: RangePreset) {
  draftStartDate.value = presetStart(preset)
  draftEndDate.value = today(timeZone)
  draftStartTime.value = new Time(0, 0)
  draftEndTime.value = new Time(23, 59)
}

function clearDraft() {
  draftStartDate.value = undefined
  draftStartTime.value = undefined
  draftEndDate.value = undefined
  draftEndTime.value = undefined
}

function cancel() {
  syncDraft()
  open.value = false
}

function applyDraft() {
  if (!canApply.value) return

  const startValue = toDateTime(draftStartDate.value, draftStartTime.value, new Time(0, 0))
  const endValue = toDateTime(draftEndDate.value, draftEndTime.value, new Time(23, 59))
  start.value = startValue ? calendarToDateTimeLocal(startValue) : ''
  end.value = endValue ? calendarToDateTimeLocal(endValue) : ''
  open.value = false
  emit('apply')
}
</script>

<template>
  <div :class="props.block ? 'w-full' : 'inline-flex'">
    <UPopover
      v-model:open="open"
      :content="{ align: 'start', side: 'bottom', sideOffset: 8, collisionPadding: 16 }"
      :ui="{ content: 'overflow-hidden p-0' }"
    >
      <UButton
        color="neutral"
        :variant="displayLabel ? 'soft' : 'outline'"
        :size="props.size"
        :disabled="props.disabled"
        :icon="props.icon"
        :block="props.block"
        :aria-label="displayLabel || resolvedPlaceholder"
        class="group justify-start font-normal"
        :class="displayLabel ? 'text-default' : 'text-dimmed'"
      >
        <span class="min-w-0 flex-1 truncate text-left">
          {{ displayLabel || resolvedPlaceholder }}
        </span>

        <template #trailing>
          <UIcon
            name="i-mdi-chevron-down"
            class="size-4 shrink-0 text-dimmed transition-transform duration-200 motion-reduce:transition-none group-data-[state=open]:rotate-180"
          />
        </template>
      </UButton>

      <template #content>
        <div class="w-[min(calc(100vw-2rem),40rem)]">
          <div class="flex flex-wrap gap-1 border-b border-default bg-elevated/40 p-2">
            <UButton
              v-for="preset in presets"
              :key="preset.label"
              :label="preset.label"
              :color="isPresetActive(preset) ? 'primary' : 'neutral'"
              :variant="isPresetActive(preset) ? 'soft' : 'ghost'"
              size="xs"
              class="font-normal"
              @click="selectPreset(preset)"
            />
          </div>

          <UCalendar
            v-model="rangeProxy"
            :number-of-months="showTwoMonths ? 2 : 1"
            :disabled="props.disabled"
            range
            size="sm"
            class="mx-auto p-3"
          />

          <div class="grid grid-cols-2 gap-3 border-t border-default px-3 py-2.5">
            <UFormField :label="$t('common.dateTime.startTime')">
              <UInputTime
                v-model="startTimeProxy"
                :hour-cycle="24"
                :disabled="props.disabled || !draftStartDate"
                size="sm"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('common.dateTime.endTime')">
              <UInputTime
                v-model="endTimeProxy"
                :hour-cycle="24"
                :disabled="props.disabled || !draftEndDate"
                size="sm"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="flex items-center justify-between gap-2 border-t border-default p-2">
            <UButton
              v-if="props.clearable"
              :label="$t('common.actions.clear')"
              color="neutral"
              variant="ghost"
              size="sm"
              :disabled="!hasDraftValue"
              @click="clearDraft"
            />
            <span v-else />

            <div class="flex items-center gap-2">
              <UButton
                :label="$t('common.actions.cancel')"
                color="neutral"
                variant="ghost"
                size="sm"
                @click="cancel"
              />
              <UButton
                :label="$t('common.actions.done')"
                size="sm"
                :disabled="!canApply"
                @click="applyDraft"
              />
            </div>
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
