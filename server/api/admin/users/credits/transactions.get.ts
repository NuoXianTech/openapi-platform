/**
 * Admin · 已入账流水与待结算扣费查询
 *
 * Query:
 *   - userId?     : number  指定用户
 *   - status?     : all / posted / exceptions / active / pending / dead_letter
 *   - reason?     : string  admin_grant/admin_revoke/admin_reset/api_charge/api_refund
 *   - limit?      : 默认 20，最大 200
 *   - offset?     : 默认 0
 */

import { listAdminCreditTransactions } from '~~/server/services/admin-credit-transaction-service'
import { CREDIT_TRANSACTION_STATUS_FILTERS } from '#shared/types/admin-credits'
import type { CreditReason } from '#shared/types/credit-reason'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readPaginationQuery } from '~~/server/utils/pagination'
import {
  readQueryDate,
  readQueryNumber,
  readQueryOption,
  readQueryPositiveInteger,
  readQueryText
} from '~~/server/utils/request-query'

const CREDIT_REASON_OPTIONS: CreditReason[] = [
  'admin_grant',
  'admin_revoke',
  'admin_reset',
  'api_charge',
  'api_refund',
  'signup_bonus',
  'redemption_code',
  'checkin'
]
const DIRECTION_OPTIONS = ['in', 'out'] as const

export default defineAdminEventHandler((event) => {
  const { query, limit, offset } = readPaginationQuery(event, { defaultLimit: 20 })

  const userId = readQueryPositiveInteger(query.userId)
  const reason = readQueryOption(query.reason, CREDIT_REASON_OPTIONS)

  return listAdminCreditTransactions({
    status: readQueryOption(query.status, CREDIT_TRANSACTION_STATUS_FILTERS),
    userId,
    reason,
    direction: readQueryOption(query.direction, DIRECTION_OPTIONS),
    operatorName: readQueryText(query.operatorName),
    startAt: readQueryDate(query.startAt),
    endAt: readQueryDate(query.endAt),
    minAmount: readQueryNumber(query.minAmount),
    maxAmount: readQueryNumber(query.maxAmount),
    limit,
    offset
  })
})
