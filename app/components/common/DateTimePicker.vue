<script setup lang="ts">
import {
  CalendarDate,
  CalendarDateTime,
  DateFormatter,
  getLocalTimeZone,
  now,
  Time,
  toCalendarDate
} from '@internationalized/date'

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
  icon: 'i-mdi-calendar-clock-outline',
  block: true
})

const emit = defineEmits<{
  apply: []
}>()

const value = defineModel<string>({ default: '' })
const { t, locale } = useI18n()
const resolvedPlaceholder = computed(() => props.placeholder || t('common.dateTime.selectDateTime'))

const open = ref(false)
const timeZone = getLocalTimeZone()
const labelFormatter = computed(() => new DateFormatter(locale.value, {
  dateStyle: 'medium',
  timeStyle: 'short'
}))

const draftDate = ref<CalendarDate>()
const draftTime = ref<Time>()

function syncDraft() {
  const dateTime = dateTimeLocalToCalendar(value.value)
  draftDate.value = dateTime
    ? new CalendarDate(dateTime.year, dateTime.month, dateTime.day)
    : undefined
  draftTime.value = dateTime
    ? new Time(dateTime.hour, dateTime.minute)
    : undefined
}

watch(value, () => {
  if (!open.value) syncDraft()
}, { immediate: true })

watch(open, (isOpen) => {
  if (isOpen) syncDraft()
})

const calendarProxy = computed({
  get: () => draftDate.value,
  set: (date: CalendarDate | undefined) => {
    draftDate.value = date ?? undefined
    if (date && !draftTime.value) draftTime.value = new Time(0, 0)
    if (!date) draftTime.value = undefined
  }
})

const timeProxy = computed({
  get: () => draftTime.value ?? new Time(0, 0),
  set: (time: Time) => {
    draftTime.value = time
  }
})

const displayLabel = computed(() => {
  const dateTime = dateTimeLocalToCalendar(value.value)
  return dateTime ? labelFormatter.value.format(dateTime.toDate(timeZone)) : ''
})

const hasDraftValue = computed(() => Boolean(draftDate.value || draftTime.value))

function selectNow() {
  const currentDateTime = now(timeZone)
  draftDate.value = toCalendarDate(currentDateTime)
  draftTime.value = new Time(currentDateTime.hour, currentDateTime.minute)
}

function clearDraft() {
  draftDate.value = undefined
  draftTime.value = undefined
}

function cancel() {
  syncDraft()
  open.value = false
}

function applyDraft() {
  if (!draftDate.value) {
    value.value = ''
  } else {
    const time = draftTime.value ?? new Time(0, 0)
    value.value = calendarToDateTimeLocal(new CalendarDateTime(
      draftDate.value.year,
      draftDate.value.month,
      draftDate.value.day,
      time.hour,
      time.minute
    ))
  }

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
        variant="outline"
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
        <div class="w-[min(calc(100vw-2rem),20rem)]">
          <UCalendar
            v-model="calendarProxy"
            :disabled="props.disabled"
            size="sm"
            class="mx-auto p-3"
          />

          <div class="flex items-end gap-2 border-t border-default px-3 py-2.5">
            <UFormField
              :label="$t('common.dateTime.time')"
              class="min-w-0 flex-1"
            >
              <UInputTime
                v-model="timeProxy"
                :hour-cycle="24"
                :disabled="props.disabled || !draftDate"
                size="sm"
                class="w-full"
              />
            </UFormField>
            <UButton
              :label="$t('common.dateTime.now')"
              color="neutral"
              variant="soft"
              size="sm"
              @click="selectNow"
            />
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
                @click="applyDraft"
              />
            </div>
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
