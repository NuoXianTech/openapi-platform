import type { AdminDashboardHourlyPoint } from '#shared/types/admin'

const HOUR_MS = 60 * 60 * 1000

export interface AdminHourlyTrendRow {
  timestamp: number
  intervalEnd: number
  totalCalls: number
}

export function createAdminHourlyTrendRows(trend: readonly AdminDashboardHourlyPoint[]): AdminHourlyTrendRow[] {
  const rows = trend.map(point => ({
    timestamp: new Date(point.hour).getTime(),
    intervalEnd: new Date(point.hour).getTime(),
    totalCalls: point.totalCalls
  }))
  const first = rows[0]
  // Extend the first hourly interval to its start, retaining its real tooltip range.
  return first ? [{ ...first, timestamp: first.timestamp - HOUR_MS }, ...rows] : []
}
