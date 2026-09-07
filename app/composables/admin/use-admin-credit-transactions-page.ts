import { computed, ref } from 'vue'
import type { BadgeProps } from '@nuxt/ui'
import {
  CREDIT_TRANSACTION_STATUS_FILTERS,
  type AdminCreditReservationRow,
  type AdminCreditTransactionRow,
  type CreditReservationAction,
  type CreditReservationStatus,
  type CreditTransactionStatusFilter
} from '#shared/types/admin-credits'
import type { CreditReasonFilter } from '#shared/types/credit-reason'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'
import { parseFetchError } from '~/utils/client-error'

interface CreditTransactionFilters {
  status: CreditTransactionStatusFilter
  userId: number | ''
  reason: CreditReasonFilter
  direction: 'all' | 'in' | 'out'
  operatorName: string
  startAt: string
  endAt: string
  minAmount: number | ''
  maxAmount: number | ''
}

function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

function availableActions(status: CreditReservationStatus): CreditReservationAction[] {
  if (status === 'active') return ['release']
  if (status === 'pending') return ['charge', 'release']
  return ['retry', 'charge', 'release']
}

export function useAdminCreditTransactionsPage() {
  const { t } = useI18n()
  const list = usePrivatePagedList<CreditTransactionFilters, AdminCreditTransactionRow>({
    path: '/api/admin/users/credits/transactions',
    defaultFilters: {
      status: 'all', userId: '', reason: 'all', direction: 'all', operatorName: '',
      startAt: '', endAt: '', minAmount: '', maxAmount: ''
    },
    buildQuery: (filters, pagination) => ({
      status: filters.status === 'all' ? undefined : filters.status,
      userId: filters.userId || undefined,
      reason: filters.reason === 'all' ? undefined : filters.reason,
      direction: filters.direction === 'all' ? undefined : filters.direction,
      operatorName: filters.operatorName.trim() || undefined,
      startAt: toIsoDateTime(filters.startAt),
      endAt: toIsoDateTime(filters.endAt),
      minAmount: filters.minAmount === '' ? undefined : filters.minAmount,
      maxAmount: filters.maxAmount === '' ? undefined : filters.maxAmount,
      limit: pagination.limit,
      offset: pagination.offset
    })
  })
  const { filters } = list
  const statusItems = computed(() => CREDIT_TRANSACTION_STATUS_FILTERS.map(value => ({
    value, label: t(`admin.credits.transactions.statusFilters.${value}`)
  })))
  const advancedFilterCount = computed(() => [
    filters.userId !== '', filters.reason !== 'all', filters.direction !== 'all',
    filters.operatorName.trim() !== '', filters.minAmount !== '', filters.maxAmount !== ''
  ].filter(Boolean).length)

  const processingOpen = ref(false)
  const selectedReservation = ref<AdminCreditReservationRow | null>(null)
  const selectedAction = ref<CreditReservationAction>()
  const processing = ref(false)
  const processingError = ref<string | null>(null)
  const feedback = ref<{ message: string, color: 'success' | 'error' } | null>(null)
  const processingActions = computed(() => (selectedReservation.value
    ? availableActions(selectedReservation.value.status)
    : []).map(value => ({
    value,
    label: t(`admin.credits.transactions.processing.actions.${value}`),
    description: t(`admin.credits.transactions.processing.actionDescriptions.${value}`)
  })))

  function statusLabel(row: AdminCreditTransactionRow) {
    const status = row.status === 'pending' && row.reservation.attempts > 0 ? 'retrying' : row.status
    return t(`admin.credits.transactions.statuses.${status}`)
  }

  function statusColor(row: AdminCreditTransactionRow): BadgeProps['color'] {
    if (row.status === 'dead_letter') return 'error'
    if (row.status === 'pending') return 'warning'
    if (row.status === 'posted') return 'success'
    return 'neutral'
  }

  function openProcessing(row: AdminCreditTransactionRow) {
    if (row.kind !== 'reservation' || processing.value || list.loading.value) return
    selectedReservation.value = row
    selectedAction.value = undefined
    processingError.value = null
    processingOpen.value = true
  }

  async function processReservation() {
    const row = selectedReservation.value
    const action = selectedAction.value
    if (!processingOpen.value || !row || !action || processing.value || list.loading.value
      || !availableActions(row.status).includes(action)) return

    processing.value = true
    processingError.value = null
    feedback.value = null
    try {
      await $fetch(`/api/admin/credits/reservations/${row.creditReservationId}/${action}`, { method: 'POST' })
      processingOpen.value = false
      feedback.value = { message: t(`admin.credits.transactions.processing.feedback.${action}`), color: 'success' }
      await list.refresh()
    } catch (error: unknown) {
      const message = parseFetchError(error, t('common.feedback.operationFailed'))
      processingError.value = message
      // Automatic settlement can finish while the dialog is open. Refresh the
      // row and its permitted actions before offering a manual retry.
      await list.refresh()
      const current = list.items.value.find(item => item.key === row.key)
      if (current?.kind === 'reservation') {
        selectedReservation.value = current
        if (!availableActions(current.status).includes(action)) selectedAction.value = undefined
      } else if (!list.error.value) {
        processingOpen.value = false
        feedback.value = { message, color: 'error' }
      }
    } finally {
      processing.value = false
    }
  }

  async function resetAdvancedFilters() {
    Object.assign(filters, { userId: '', reason: 'all', direction: 'all', operatorName: '', minAmount: '', maxAmount: '' })
    await list.applyFilters()
  }

  return {
    ...list, statusItems, advancedFilterCount, statusLabel, statusColor, resetAdvancedFilters,
    processingOpen, selectedReservation, selectedAction, processing, processingError,
    feedback, processingActions, openProcessing, processReservation
  }
}
