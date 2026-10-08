import type { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../../../helpers/database'
import { APP_TIME_ZONE } from '~~/server/utils/local-time'

const context = vi.hoisted(() => ({ database: null as unknown }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
const { userDashboardService } = await import('~~/server/services/user-dashboard-service')
const NOW = new Date('2026-10-08T05:30:00.000Z')
const HOUR_MS = 60 * 60 * 1000
let client: PGlite

beforeAll(async () => {
  const testDatabase = await createTestDatabase()
  client = testDatabase.client
  context.database = testDatabase.database
})

beforeEach(async () => {
  await client.exec(`
    TRUNCATE api_calls, users RESTART IDENTITY CASCADE;
    SET TIME ZONE 'UTC';
    INSERT INTO users (username, email, password_hash, credits)
    VALUES ('hourly-user', 'hourly@example.test', 'hash', 100);
    INSERT INTO api_keys (user_id, name, key_digest, key_ciphertext, key_preview)
    VALUES (1, 'hourly-key', 'digest', 'ciphertext', 'preview');
  `)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())
afterAll(async () => client.close())

async function insertCall(timestamp: number, options: {
  userId?: number
  counted?: boolean
  status?: number
  error?: string
  credits?: number
} = {}) {
  await client.query(`
    INSERT INTO api_calls
      (route_id, user_id, path, method, created_at, is_counted, status_code, error_code, credits_cost)
    VALUES ('00000000-0000-4000-8000-000000000001', $1, '/hourly', 'GET', $2, $3, $4, $5, $6)
  `, [options.userId ?? 1, new Date(timestamp).toISOString(), options.counted ?? true,
    options.status ?? 200, options.error ?? null, options.credits ?? 0])
}

describe('user dashboard rolling 24-hour statistics', () => {
  it('retains the call in the first partial natural hour in both summary and chart', async () => {
    await insertCall(new Date('2026-10-07T05:45:00.000Z').getTime(), { credits: 3 })
    const dashboard = await userDashboardService.getDashboard(1)

    expect(dashboard.calls.requests24h).toBe(1)
    expect(dashboard.credits.spent24h).toBe(3)
    expect(dashboard.hourlyTrend24h).toHaveLength(24)
    expect(dashboard.hourlyTrend24h[0]).toMatchObject({
      hour: '2026-10-07T06:30:00.000Z', successCalls: 1, failureCalls: 0
    })
    expect(dashboard.hourlyTrend24h.reduce((sum, p) => sum + p.successCalls + p.failureCalls, 0))
      .toBe(dashboard.calls.requests24h)
    expect(dashboard.credits.balance).toBe(100)
    expect(dashboard.apiKeys).toEqual({ total: 1, active: 1 })
  })

  it.each(['2026-10-08T05:30:42.123Z', '2026-10-08T06:00:00.000Z'])(
    'uses half-open hourly intervals across the entire window at %s', async (timestamp) => {
      const end = new Date(timestamp).getTime()
      const start = end - 24 * HOUR_MS
      vi.setSystemTime(end)
      await insertCall(start - 1, { credits: 100 })
      await insertCall(start, { credits: 2 })
      await insertCall(start + HOUR_MS - 1, { status: 302, credits: 3 })
      await insertCall(start + HOUR_MS, { status: 404 })
      await insertCall(end - 1, { error: 'UPSTREAM_STREAM_ERROR' })
      await insertCall(end, { credits: 100 })
      await insertCall(end + 1, { credits: 100 })
      await insertCall(end - 1, { counted: false, status: 403 })
      await insertCall(end - 1, { userId: 2, credits: 100 })

      const { calls, credits, hourlyTrend24h: trend } = await userDashboardService.getDashboard(1)
      expect(calls.requests24h).toBe(4)
      expect(credits.spent24h).toBe(5)
      expect(trend[0]).toMatchObject({ successCalls: 2, failureCalls: 0 })
      expect(trend[1]).toMatchObject({ successCalls: 0, failureCalls: 1 })
      expect(trend.at(-1)).toMatchObject({ hour: new Date(end).toISOString(), successCalls: 0, failureCalls: 1 })
      expect(trend.reduce((sum, point) => sum + point.successCalls + point.failureCalls, 0)).toBe(4)
      for (const [index, point] of trend.entries()) {
        expect(point.hour).toBe(new Date(start + (index + 1) * HOUR_MS).toISOString())
      }
    }
  )

  it.each([
    ['Asia/Kathmandu', '2026-10-08T05:30:00.000Z'],
    ['America/New_York', '2026-11-01T06:30:00.000Z'],
    ['Asia/Shanghai', '2026-01-01T00:15:00.000Z']
  ])('preserves all buckets in database timezone %s at %s', async (timeZone, timestamp) => {
    vi.setSystemTime(new Date(timestamp))
    await client.query("SELECT set_config('TimeZone', $1, false)", [timeZone])
    const end = new Date(timestamp).getTime()
    for (let index = 0; index < 24; index += 1) {
      await insertCall(end - (24 - index) * HOUR_MS)
    }

    const dashboard = await userDashboardService.getDashboard(1)
    expect(dashboard.calls.requests24h).toBe(24)
    expect(dashboard.hourlyTrend24h.every(point => point.successCalls === 1 && point.failureCalls === 0)).toBe(true)
    const label = new Intl.DateTimeFormat('en-GB', {
      timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date(timestamp))
    expect(dashboard.hourlyTrend24h.at(-1)).toMatchObject({ hour: timestamp, label })
  })

  it('zero fills an empty window and isolates another user', async () => {
    await insertCall(NOW.getTime() - 1, { userId: 2, credits: 10 })
    const dashboard = await userDashboardService.getDashboard(1)
    expect(dashboard.calls.requests24h).toBe(0)
    expect(dashboard.credits.spent24h).toBe(0)
    expect(dashboard.hourlyTrend24h).toHaveLength(24)
    expect(dashboard.hourlyTrend24h.every(point => point.successCalls === 0 && point.failureCalls === 0)).toBe(true)
  })

  it('keeps the same observation time if the query completes in the next hour', async () => {
    await insertCall(NOW.getTime() - 1, { credits: 2 })
    const pending = userDashboardService.getDashboard(1)
    vi.setSystemTime(new Date(NOW.getTime() + HOUR_MS))
    const dashboard = await pending
    expect(dashboard.generatedAt).toBe(NOW.toISOString())
    expect(dashboard.hourlyTrend24h.at(-1)?.hour).toBe(NOW.toISOString())
    expect(dashboard.calls.requests24h).toBe(1)
    expect(dashboard.credits.spent24h).toBe(2)
  })
})
