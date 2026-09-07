import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'

const testContext = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
}))

const { adminDashboardService } = await import('~~/server/services/admin-dashboard-service')
const NOW = new Date('2026-09-07T10:37:42.123Z')
const HOUR_MS = 60 * 60 * 1000
let client: PGlite

beforeAll(async () => {
  client = new PGlite()
  await client.exec(`
    CREATE TABLE api_calls (
      id bigserial PRIMARY KEY,
      is_counted boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL
    );
  `)
  testContext.database = drizzle(client, { schema })
})

beforeEach(async () => {
  await client.exec("TRUNCATE api_calls RESTART IDENTITY; SET TIME ZONE 'UTC';")
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => vi.useRealTimers())
afterAll(async () => client.close())

async function insertCall(timestamp: number, counted = true) {
  await client.query('INSERT INTO api_calls (created_at, is_counted) VALUES ($1, $2)', [
    new Date(timestamp).toISOString(), counted
  ])
}

describe('admin dashboard rolling 24-hour trend', () => {
  it('fills 24 hourly intervals through the exact snapshot time when there are no calls', async () => {
    const { hourlyTrend24h: trend } = await adminDashboardService.getInsights()

    expect(trend).toHaveLength(24)
    expect(trend.every(point => point.totalCalls === 0)).toBe(true)
    expect(trend.at(-1)?.hour).toBe(NOW.toISOString())
    expect(new Date(trend[0]!.hour).getTime() - HOUR_MS).toBe(NOW.getTime() - 24 * HOUR_MS)
    for (let index = 1; index < trend.length; index += 1) {
      expect(new Date(trend[index]!.hour).getTime() - new Date(trend[index - 1]!.hour).getTime()).toBe(HOUR_MS)
    }
  })

  it('counts the first partial calendar hour and excludes old, future and uncounted calls', async () => {
    const start = NOW.getTime() - 24 * HOUR_MS
    for (const timestamp of [
      start - 1, start, start + 1, start + HOUR_MS - 1, start + HOUR_MS,
      NOW.getTime() - HOUR_MS, NOW.getTime() - 1, NOW.getTime(), NOW.getTime() + 1
    ]) {
      await insertCall(timestamp)
    }
    await insertCall(NOW.getTime() - 1, false)

    const { hourlyTrend24h: trend } = await adminDashboardService.getInsights()

    expect(trend[0]?.totalCalls).toBe(3)
    expect(trend[1]?.totalCalls).toBe(1)
    expect(trend.at(-1)?.totalCalls).toBe(2)
    expect(trend.reduce((total, point) => total + point.totalCalls, 0)).toBe(6)
  })

  it.each([
    ['Asia/Kathmandu', '2026-09-07T10:37:42.123Z'],
    ['America/New_York', '2026-11-01T09:12:34.000Z'],
    ['Asia/Shanghai', '2026-01-01T00:15:00.000Z']
  ])('keeps the same 24 elapsed hours with database timezone %s at %s', async (timeZone, timestamp) => {
    const now = new Date(timestamp)
    vi.setSystemTime(now)
    await client.query("SELECT set_config('TimeZone', $1, false)", [timeZone])
    await insertCall(now.getTime() - 24 * HOUR_MS)
    await insertCall(now.getTime() - 1)

    const { hourlyTrend24h: trend } = await adminDashboardService.getInsights()

    expect(trend).toHaveLength(24)
    expect(trend.at(-1)?.hour).toBe(timestamp)
    expect(trend[0]?.totalCalls).toBe(1)
    expect(trend.at(-1)?.totalCalls).toBe(1)
    expect(trend.reduce((total, point) => total + point.totalCalls, 0)).toBe(2)
  })

  it('uses one snapshot time even when the query finishes in a later hour', async () => {
    await insertCall(NOW.getTime() - 1)
    const pending = adminDashboardService.getInsights()
    vi.setSystemTime(new Date(NOW.getTime() + HOUR_MS))
    const { hourlyTrend24h: trend } = await pending

    expect(trend.at(-1)?.hour).toBe(NOW.toISOString())
    expect(trend.at(-1)?.totalCalls).toBe(1)
  })
})
