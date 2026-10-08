import { and, asc, eq, gte, lt, sql } from 'drizzle-orm'
import type { AdminDashboardInsightsData } from '#shared/types/admin'
import type { UserDashboardHourlyPoint } from '#shared/types/user-dashboard'
import { db } from '~~/server/db/client'
import { apiCalls } from '~~/server/db/schema'
import { APP_TIME_ZONE } from '~~/server/utils/local-time'
import { toNumber } from '~~/server/utils/number'

const HOUR_MS = 60 * 60 * 1000
const HOURS = 24
const LABEL_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

/** Query, bucketing and zero filling share one half-open window. Epoch offsets
 * keep SQL independent of the database session timezone, including DST shifts. */
async function readHours(end: Date, userId?: number) {
  const start = new Date(end.getTime() - HOURS * HOUR_MS)
  const source = db.select({
    bucket: sql<number>`floor(extract(epoch from (${apiCalls.createdAt} - ${start.toISOString()}::timestamptz)) / 3600)::integer`.as('bucket'),
    isCounted: apiCalls.isCounted,
    statusCode: apiCalls.statusCode,
    errorCode: apiCalls.errorCode,
    creditsCost: apiCalls.creditsCost
  }).from(apiCalls)
    .where(and(
      gte(apiCalls.createdAt, start),
      lt(apiCalls.createdAt, end),
      userId === undefined ? eq(apiCalls.isCounted, true) : eq(apiCalls.userId, userId)
    ))
    .as('hourly_calls')
  const success = sql`${source.statusCode} >= 200 and ${source.statusCode} < 400 and ${source.errorCode} is null`
  const rows = await db.select({
    bucket: source.bucket,
    totalCalls: sql<number>`count(*) filter (where ${source.isCounted})`,
    successCalls: sql<number>`count(*) filter (where ${source.isCounted} and ${success})`,
    failureCalls: sql<number>`count(*) filter (where ${source.isCounted} and not (${success}))`,
    creditsSpent: sql<number>`coalesce(sum(${source.creditsCost}), 0)`
  }).from(source).groupBy(source.bucket).orderBy(asc(source.bucket))
  const buckets = new Map(rows.map(row => [toNumber(row.bucket), row]))

  return Array.from({ length: HOURS }, (_, index) => {
    const end = new Date(start.getTime() + (index + 1) * HOUR_MS)
    const row = buckets.get(index)
    return {
      hour: end.toISOString(),
      label: LABEL_FORMATTER.format(end),
      totalCalls: toNumber(row?.totalCalls),
      successCalls: toNumber(row?.successCalls),
      failureCalls: toNumber(row?.failureCalls),
      creditsSpent: toNumber(row?.creditsSpent)
    }
  })
}

export const callHourlyStatistics = {
  /** Rolling 24 hours ending at the same instant as the rest of this dashboard. */
  async forUser(userId: number, now: Date): Promise<{
    requests24h: number
    spent24h: number
    hourlyTrend24h: UserDashboardHourlyPoint[]
  }> {
    const hours = await readHours(now, userId)
    return {
      requests24h: hours.reduce((sum, hour) => sum + hour.totalCalls, 0),
      spent24h: hours.reduce((sum, hour) => sum + hour.creditsSpent, 0),
      hourlyTrend24h: hours.map(({ hour, label, successCalls, failureCalls }) => ({
        hour, label, successCalls, failureCalls
      }))
    }
  },

  /** The last 24 complete hours; the current incomplete hour is excluded. */
  async forPlatform(): Promise<AdminDashboardInsightsData> {
    const end = new Date()
    end.setMinutes(0, 0, 0)
    const hours = await readHours(end)
    return {
      hourlyTrend24h: hours.map(({ hour, label, totalCalls }) => ({ hour, label, totalCalls }))
    }
  }
}
