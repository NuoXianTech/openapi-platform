import { and, asc, count, desc, eq, gt, gte, ilike, lt, lte, notExists, or, sql, type SQL } from 'drizzle-orm'
import { db } from '~~/server/db/client'
import { apiCreditReservations, apiKeys, apiRoutes, creditTransactions, users } from '~~/server/db/schema'
import type { AdminCreditTransactionRow, CreditTransactionStatus, CreditTransactionStatusFilter } from '#shared/types/admin-credits'
import type { CreditReason } from '#shared/types/credit-reason'
import { toIsoString, toNullableIsoString } from '~~/server/utils/date'
import { normalizePagination } from '~~/server/utils/pagination'
import { toNumber } from '~~/server/utils/number'

interface ListTransactionsFilters {
  status?: CreditTransactionStatusFilter
  userId?: number
  reason?: CreditReason
  direction?: 'in' | 'out'
  operatorName?: string
  startAt?: Date
  endAt?: Date
  minAmount?: number
  maxAmount?: number
  limit?: number
  offset?: number
}

export async function listAdminCreditTransactions(filters: ListTransactionsFilters = {}) {
  const transactions = db.select({
    id: creditTransactions.id,
    kind: sql<'transaction' | 'reservation'>`'transaction'`.as('kind'),
    status: sql<CreditTransactionStatus>`'posted'`.as('status'),
    userId: creditTransactions.userId,
    amount: creditTransactions.amount,
    balanceAfter: sql<number | null>`${creditTransactions.balanceAfter}`.as('balance_after'),
    reason: creditTransactions.reason,
    routeId: creditTransactions.routeId,
    apiCallId: creditTransactions.apiCallId,
    creditReservationId: creditTransactions.creditReservationId,
    codeId: creditTransactions.codeId,
    operatorId: creditTransactions.operatorId,
    operatorName: creditTransactions.operatorName,
    ip: creditTransactions.ip,
    remark: creditTransactions.remark,
    meta: creditTransactions.meta,
    createdAt: creditTransactions.createdAt,
    apiKeyId: sql<number | null>`null::integer`.as('api_key_id'),
    requestId: sql<string | null>`null::text`.as('request_id'),
    attempts: sql<number>`0`.as('attempts'),
    lastError: sql<string | null>`null::text`.as('last_error'),
    lastAttemptAt: sql<Date | string | null>`null::timestamptz`.as('last_attempt_at'),
    nextAttemptAt: sql<Date | string | null>`null::timestamptz`.as('next_attempt_at')
  }).from(creditTransactions)

  const reservations = db.select({
    id: apiCreditReservations.id,
    kind: sql<'transaction' | 'reservation'>`'reservation'`.as('kind'),
    status: sql<CreditTransactionStatus>`${apiCreditReservations.status}`.as('status'),
    userId: apiCreditReservations.userId,
    amount: sql<number>`-${apiCreditReservations.amount}`.as('amount'),
    balanceAfter: sql<number | null>`null::integer`.as('balance_after'),
    reason: sql<string>`'api_charge'`.as('reason'),
    routeId: apiCreditReservations.routeId,
    apiCallId: apiCreditReservations.apiCallId,
    creditReservationId: apiCreditReservations.id,
    codeId: sql<number | null>`null::integer`.as('code_id'),
    operatorId: sql<number | null>`null::integer`.as('operator_id'),
    operatorName: sql<string | null>`null::text`.as('operator_name'),
    ip: sql<string | null>`null::text`.as('ip'),
    remark: sql<string | null>`null::text`.as('remark'),
    meta: sql<Record<string, unknown> | null>`null::jsonb`.as('meta'),
    createdAt: apiCreditReservations.createdAt,
    apiKeyId: apiCreditReservations.apiKeyId,
    requestId: sql<string>`${apiCreditReservations.requestId}::text`.as('request_id'),
    attempts: apiCreditReservations.attempts,
    lastError: apiCreditReservations.lastError,
    lastAttemptAt: apiCreditReservations.lastAttemptAt,
    nextAttemptAt: apiCreditReservations.nextAttemptAt
  }).from(apiCreditReservations).where(notExists(
    db.select({ id: creditTransactions.id }).from(creditTransactions)
      .where(eq(creditTransactions.creditReservationId, apiCreditReservations.id))
  ))

  // Sort and paginate the combined records in SQL so pending charges cannot
  // disappear between independently paginated lists or look like posted debits.
  const entries = transactions.unionAll(reservations).as('credit_entries')
  const conditions: SQL[] = []
  if (filters.status === 'exceptions') {
    conditions.push(or(
      eq(entries.status, 'dead_letter'),
      and(eq(entries.status, 'pending'), gt(entries.attempts, 0))
    )!)
  } else if (filters.status && filters.status !== 'all') {
    conditions.push(eq(entries.status, filters.status))
  }
  if (typeof filters.userId === 'number') conditions.push(eq(entries.userId, filters.userId))
  if (filters.reason) conditions.push(eq(entries.reason, filters.reason))
  if (filters.direction === 'in') conditions.push(gt(entries.amount, 0))
  if (filters.direction === 'out') conditions.push(lt(entries.amount, 0))
  if (filters.operatorName) conditions.push(ilike(entries.operatorName, `%${filters.operatorName}%`))
  if (filters.startAt) conditions.push(gte(entries.createdAt, filters.startAt))
  if (filters.endAt) conditions.push(lte(entries.createdAt, filters.endAt))
  if (typeof filters.minAmount === 'number') conditions.push(gte(entries.amount, filters.minAmount))
  if (typeof filters.maxAmount === 'number') conditions.push(lte(entries.amount, filters.maxAmount))
  const where = and(...conditions)
  const { limit, offset } = normalizePagination(filters)
  const [rows, totalRows] = await Promise.all([
    db.select({
      entry: {
        id: entries.id,
        kind: entries.kind,
        status: entries.status,
        userId: entries.userId,
        amount: entries.amount,
        balanceAfter: entries.balanceAfter,
        reason: entries.reason,
        routeId: entries.routeId,
        apiCallId: entries.apiCallId,
        creditReservationId: entries.creditReservationId,
        codeId: entries.codeId,
        operatorId: entries.operatorId,
        operatorName: entries.operatorName,
        ip: entries.ip,
        remark: entries.remark,
        meta: entries.meta,
        createdAt: entries.createdAt,
        apiKeyId: entries.apiKeyId,
        requestId: entries.requestId,
        attempts: entries.attempts,
        lastError: entries.lastError,
        lastAttemptAt: entries.lastAttemptAt,
        nextAttemptAt: entries.nextAttemptAt
      },
      userName: users.username,
      userRole: users.role,
      apiKeyName: apiKeys.name,
      routeName: apiRoutes.name,
      routePath: apiRoutes.pathPattern
    }).from(entries)
      .leftJoin(users, eq(users.id, entries.userId))
      .leftJoin(apiKeys, eq(apiKeys.id, entries.apiKeyId))
      .leftJoin(apiRoutes, eq(apiRoutes.id, entries.routeId))
      .where(where)
      .orderBy(desc(entries.createdAt), desc(entries.id), asc(entries.kind))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(entries).where(where)
  ])

  const items: AdminCreditTransactionRow[] = rows.map(({ entry, apiKeyName, ...labels }) => {
    const { kind, status, balanceAfter, apiKeyId, requestId, attempts, lastError, lastAttemptAt, nextAttemptAt, ...fields } = entry
    const common = {
      ...fields,
      ...labels,
      key: `${kind}:${entry.id}`,
      createdAt: toIsoString(entry.createdAt)
    }
    if (kind === 'reservation' && status !== 'posted') {
      return {
        ...common,
        kind,
        status,
        balanceAfter: null,
        creditReservationId: entry.id,
        reservation: {
          apiKeyId: apiKeyId!,
          apiKeyName,
          requestId: requestId!,
          attempts,
          lastError,
          lastAttemptAt: toNullableIsoString(lastAttemptAt),
          nextAttemptAt: toIsoString(nextAttemptAt!)
        }
      }
    }
    return { ...common, kind: 'transaction', status: 'posted', balanceAfter: toNumber(balanceAfter), reservation: null }
  })
  return { items, total: toNumber(totalRows[0]?.value) }
}
