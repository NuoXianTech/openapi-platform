<script setup lang="ts">
import type { AdminCreditReservationRow, CreditReservationAction } from '#shared/types/admin-credits'
import { adminModalUi } from '~/utils/admin-modal-ui'

const open = defineModel<boolean>('open', { default: false })
const action = defineModel<CreditReservationAction>('action')
const props = defineProps<{
  row: AdminCreditReservationRow | null
  actions: { value: CreditReservationAction, label: string, description: string }[]
  processing: boolean
  error: string | null
  statusLabel: string
}>()
const emit = defineEmits<{ submit: [] }>()
const { locale } = useI18n()
const formId = useId()
const canSubmit = computed(() => Boolean(props.row && action.value
  && props.actions.some(item => item.value === action.value) && !props.processing))
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('admin.credits.transactions.processing.title')"
    :description="$t('admin.credits.transactions.processing.description')"
    :dismissible="!processing"
    :close="!processing"
    :ui="adminModalUi({ content: 'sm:max-w-2xl' })"
  >
    <template #body>
      <form v-if="row" :id="formId" class="space-y-5" @submit.prevent="canSubmit && emit('submit')">
        <dl class="grid gap-4 rounded-lg border border-default bg-elevated/30 p-4 sm:grid-cols-2">
          <div>
            <dt class="text-xs text-muted">{{ $t('admin.credits.transactions.columns.user') }}</dt>
            <dd class="mt-1 text-sm font-medium text-highlighted">
              {{ row.userName || $t('common.accounts.deletedUser') }}
              <span class="ml-1 font-normal text-muted">#{{ row.userId }}</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ $t('admin.credits.transactions.processing.reservedAmount') }}</dt>
            <dd class="mt-1 text-sm font-semibold tabular-nums text-highlighted">{{ Math.abs(row.amount).toLocaleString(locale) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ $t('admin.credits.transactions.columns.status') }}</dt>
            <dd class="mt-1 text-sm text-highlighted">{{ statusLabel }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ $t('admin.credits.transactions.processing.attempts') }}</dt>
            <dd class="mt-1 text-sm tabular-nums text-highlighted">{{ row.reservation.attempts }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-xs text-muted">{{ $t('admin.credits.transactions.processing.api') }}</dt>
            <dd class="mt-1 space-y-1 text-sm text-highlighted">
              <p>{{ row.routeName || '—' }}</p>
              <code class="block break-all text-xs text-muted">{{ row.routePath || row.routeId }}</code>
            </dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ $t('admin.credits.transactions.processing.apiKey') }}</dt>
            <dd class="mt-1 break-words text-sm text-highlighted">{{ row.reservation.apiKeyName || '—' }} <span class="text-muted">#{{ row.reservation.apiKeyId }}</span></dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ $t('admin.credits.transactions.columns.time') }}</dt>
            <dd class="mt-1 text-sm text-highlighted">{{ formatDateTime(row.createdAt, '—', locale) }}</dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="text-xs text-muted">{{ $t('admin.credits.transactions.processing.requestId') }}</dt>
            <dd class="mt-1 break-all font-mono text-xs text-highlighted">{{ row.reservation.requestId }}</dd>
          </div>
        </dl>

        <div v-if="row.reservation.lastError" class="space-y-2">
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="$t('admin.credits.transactions.processing.lastError')"
            :description="row.reservation.lastError"
            :ui="{ description: 'break-words whitespace-pre-wrap' }"
          />
          <p class="text-xs leading-5 text-muted">
            {{ $t('admin.credits.transactions.processing.lastAttempt', { time: formatDateTime(row.reservation.lastAttemptAt, '—', locale) }) }}
          </p>
        </div>
        <p v-if="row.status === 'pending'" class="text-xs text-muted">
          {{ $t('admin.credits.transactions.processing.nextAttempt', { time: formatDateTime(row.reservation.nextAttemptAt, '—', locale) }) }}
        </p>

        <UFormField :label="$t('admin.credits.transactions.processing.actionLabel')" required>
          <URadioGroup
            v-model="action"
            :items="actions"
            :disabled="processing"
            color="neutral"
            variant="card"
            :ui="{ description: 'text-xs leading-5' }"
          />
        </UFormField>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
        />
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="outline" :disabled="processing" @click="open = false">
          {{ $t('common.actions.cancel') }}
        </UButton>
        <UButton
          type="submit"
          :form="formId"
          :color="action === 'release' ? 'warning' : 'primary'"
          :loading="processing"
          :disabled="!canSubmit"
        >
          {{ action ? $t('admin.credits.transactions.processing.actions.' + action) : $t('admin.credits.transactions.processing.submit') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
