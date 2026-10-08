interface UserDashboardCredits {
  balance: number
  totalSpent: number
  spent24h: number
}

interface UserDashboardCalls {
  total: number
  success: number
  failure: number
  successRate: number
  requests24h: number
}

interface UserDashboardApiKeys {
  total: number
  active: number
}

export interface UserDashboardHourlyPoint {
  /** Exclusive end of this one-hour interval in the rolling 24-hour window. */
  hour: string
  label: string
  successCalls: number
  failureCalls: number
}

export interface UserDashboardTrendPoint {
  date: string
  totalCalls: number
  creditsSpent: number
}

export interface UserDashboardData {
  credits: UserDashboardCredits
  calls: UserDashboardCalls
  apiKeys: UserDashboardApiKeys
  trend: UserDashboardTrendPoint[]
  hourlyTrend24h: UserDashboardHourlyPoint[]
  generatedAt: string
}
