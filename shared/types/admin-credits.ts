export interface AdminCreditOverviewSummary {
  totalBalance: number
  userCount: number
  usersWithBalance: number
  averageBalance: number
  income24h: number
  expense24h: number
  netChange24h: number
  transactionCount24h: number
  activeRedemptionCodes: number
  redemptionPotential: number
}

export interface AdminCreditRecentTransaction {
  id: number
  userId: number | null
  userName: string | null
  userRole: 'user' | 'admin' | null
  amount: number
  balanceAfter: number
  reason: string
  operatorName: string | null
  remark: string | null
  createdAt: string
}

export interface AdminCreditOverview {
  generatedAt: string
  summary: AdminCreditOverviewSummary
  recentTransactions: AdminCreditRecentTransaction[]
}

export type CreditReservationStatus = 'active' | 'pending' | 'dead_letter'

export const CREDIT_TRANSACTION_STATUS_FILTERS = [
  'all', 'exceptions', 'dead_letter', 'pending', 'active', 'posted'
] as const
export type CreditTransactionStatusFilter = typeof CREDIT_TRANSACTION_STATUS_FILTERS[number]
export type CreditTransactionStatus = 'posted' | CreditReservationStatus
export type CreditReservationAction = 'retry' | 'charge' | 'release'

export interface CreditReservationDetails {
  apiKeyId: number
  apiKeyName: string | null
  requestId: string
  attempts: number
  lastError: string | null
  lastAttemptAt: string | null
  nextAttemptAt: string
}

interface AdminCreditTransactionBase {
  key: string
  id: number
  userId: number | null
  userName: string | null
  userRole: 'user' | 'admin' | null
  /** Signed balance change for posted entries, planned debit for reservations. */
  amount: number
  reason: string
  routeId: string | null
  routeName: string | null
  routePath: string | null
  apiCallId: number | null
  creditReservationId: number | null
  codeId: number | null
  operatorId: number | null
  operatorName: string | null
  ip: string | null
  remark: string | null
  meta: Record<string, unknown> | null
  createdAt: string
}

export type AdminCreditTransactionRow = AdminCreditTransactionBase & ({
  kind: 'transaction'
  status: 'posted'
  balanceAfter: number
  reservation: null
} | {
  kind: 'reservation'
  status: CreditReservationStatus
  balanceAfter: null
  creditReservationId: number
  reservation: CreditReservationDetails
})

export type AdminCreditReservationRow = Extract<AdminCreditTransactionRow, { kind: 'reservation' }>
