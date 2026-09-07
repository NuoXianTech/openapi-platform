import { reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminCreditReservationRow, AdminCreditTransactionRow, CreditReservationStatus } from '#shared/types/admin-credits'
import { useAdminCreditTransactionsPage } from '@/composables/admin/use-admin-credit-transactions-page'

const { pagedList } = vi.hoisted(() => ({ pagedList: vi.fn() }))
vi.mock('@/composables/dashboard/use-private-paged-list', () => ({ usePrivatePagedList: pagedList }))

const fetchMock = vi.fn()
const refresh = vi.fn()
const applyFilters = vi.fn()
const items = ref<AdminCreditTransactionRow[]>([])
const loading = ref(false)
const listError = ref<unknown>(null)

function reservation(status: CreditReservationStatus = 'dead_letter'): AdminCreditReservationRow {
  return {
    key: 'reservation:7', id: 7, kind: 'reservation', status,
    userId: 1, userName: 'Alice', userRole: 'user', amount: -5, balanceAfter: null,
    reason: 'api_charge', routeId: 'route-1', routeName: 'Test API', routePath: '/v1/test',
    apiCallId: 42, creditReservationId: 7, codeId: null, operatorId: null, operatorName: null,
    ip: null, remark: null, meta: null, createdAt: '2026-09-08T10:00:00Z',
    reservation: {
      apiKeyId: 1, apiKeyName: 'Main key', requestId: 'request-1', attempts: 5,
      lastError: 'Settlement failed', lastAttemptAt: '2026-09-08T11:00:00Z',
      nextAttemptAt: '2026-09-08T12:00:00Z'
    }
  }
}

function posted(): AdminCreditTransactionRow {
  return { ...reservation(), key: 'transaction:7', kind: 'transaction', status: 'posted', balanceAfter: 95, reservation: null }
}

beforeEach(() => {
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('$fetch', fetchMock)
  fetchMock.mockResolvedValue({})
  refresh.mockResolvedValue(undefined)
  applyFilters.mockResolvedValue(undefined)
  loading.value = false
  listError.value = null
  items.value = [reservation()]
  pagedList.mockImplementation(options => ({
    filters: reactive({ ...options.defaultFilters }),
    page: ref(1), pageSize: ref(20), total: ref(1), items, loading, error: listError,
    refresh, applyFilters
  }))
})

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})

describe('admin credit transaction filters and processing', () => {
  it('queries one combined list and preserves zero, dates and other filters when selecting exceptions', () => {
    const page = useAdminCreditTransactionsPage()
    Object.assign(page.filters, {
      status: 'exceptions', userId: 1, reason: 'api_charge', direction: 'out',
      operatorName: ' Admin ', minAmount: 0, maxAmount: 100,
      startAt: '2026-09-08T10:00:00Z', endAt: '2026-09-08T12:00:00Z'
    })
    const options = pagedList.mock.calls[0]![0]
    expect(options.path).toBe('/api/admin/users/credits/transactions')
    expect(options.buildQuery(page.filters, { page: 3, limit: 20, offset: 40 })).toEqual({
      status: 'exceptions', userId: 1, reason: 'api_charge', direction: 'out', operatorName: 'Admin',
      minAmount: 0, maxAmount: 100, startAt: '2026-09-08T10:00:00.000Z', endAt: '2026-09-08T12:00:00.000Z',
      limit: 20, offset: 40
    })
    expect(page.statusItems.value.some(item => item.value === 'exceptions')).toBe(true)
  })

  it('resets advanced filters without losing the visible status or date range', async () => {
    const page = useAdminCreditTransactionsPage()
    Object.assign(page.filters, { status: 'exceptions', userId: 1, reason: 'api_charge', startAt: '2026-09-08T10:00:00Z' })
    await page.resetAdvancedFilters()
    expect(page.filters).toMatchObject({ status: 'exceptions', userId: '', reason: 'all', startAt: '2026-09-08T10:00:00Z' })
    expect(page.advancedFilterCount.value).toBe(0)
    expect(applyFilters).toHaveBeenCalledOnce()
  })

  it.each([
    ['active', ['release']],
    ['pending', ['charge', 'release']],
    ['dead_letter', ['retry', 'charge', 'release']]
  ] as const)('offers only valid actions for %s and requires an explicit choice', (status, actions) => {
    const page = useAdminCreditTransactionsPage()
    page.openProcessing(reservation(status))
    expect(page.processingOpen.value).toBe(true)
    expect(page.processingActions.value.map(item => item.value)).toEqual(actions)
    expect(page.selectedAction.value).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prevents processing posted transactions even when they retain a reservation ID', async () => {
    const page = useAdminCreditTransactionsPage()
    page.openProcessing(posted())
    page.selectedAction.value = 'charge'
    await page.processReservation()
    expect(page.processingOpen.value).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects charge and retry requests for an active call', async () => {
    const page = useAdminCreditTransactionsPage()
    page.openProcessing(reservation('active'))
    page.selectedAction.value = 'charge'
    await page.processReservation()
    page.selectedAction.value = 'retry'
    await page.processReservation()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['retry', 'charge', 'release'] as const)('performs %s once, refreshes the unified list and closes the dialog', async (action) => {
    const page = useAdminCreditTransactionsPage()
    page.openProcessing(reservation())
    page.selectedAction.value = action
    await page.processReservation()
    await page.processReservation()

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/admin/credits/reservations/7/${action}`, { method: 'POST' })
    expect(refresh).toHaveBeenCalledOnce()
    expect(page.processingOpen.value).toBe(false)
    expect(page.processing.value).toBe(false)
    expect(page.feedback.value).toEqual({ message: `admin.credits.transactions.processing.feedback.${action}`, color: 'success' })
  })

  it('blocks duplicate requests while a resolution is still running', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const page = useAdminCreditTransactionsPage()
    page.openProcessing(reservation())
    page.selectedAction.value = 'charge'
    const first = page.processReservation()
    await page.processReservation()
    expect(page.processing.value).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    finish({ charged: 5 })
    await first
    expect(page.processing.value).toBe(false)
  })

  it('keeps failures in the dialog and updates actions when the server status changes', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Already retried'))
    refresh.mockImplementationOnce(async () => { items.value = [reservation('pending')] })
    const page = useAdminCreditTransactionsPage()
    page.openProcessing(reservation())
    page.selectedAction.value = 'retry'
    await page.processReservation()

    expect(page.processingOpen.value).toBe(true)
    expect(page.processingError.value).toBeTruthy()
    expect(page.selectedReservation.value?.status).toBe('pending')
    expect(page.selectedAction.value).toBeUndefined()
    expect(page.processingActions.value.map(item => item.value)).toEqual(['charge', 'release'])
    await page.processReservation()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('closes a stale dialog when automatic settlement has already resolved the record', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Already resolved'))
    refresh.mockImplementationOnce(async () => { items.value = [posted()] })
    const page = useAdminCreditTransactionsPage()
    page.openProcessing(reservation())
    page.selectedAction.value = 'release'
    await page.processReservation()

    expect(page.processingOpen.value).toBe(false)
    expect(page.feedback.value?.color).toBe('error')
    expect(page.items.value[0]?.status).toBe('posted')
  })

  it('distinguishes normal pending settlement from a failed retry', () => {
    const page = useAdminCreditTransactionsPage()
    const row = reservation('pending')
    row.reservation.attempts = 0
    expect(page.statusLabel(row)).toBe('admin.credits.transactions.statuses.pending')
    row.reservation.attempts = 1
    expect(page.statusLabel(row)).toBe('admin.credits.transactions.statuses.retrying')
    expect(page.statusColor(reservation())).toBe('error')
    expect(page.statusColor(posted())).toBe('success')
  })
})
