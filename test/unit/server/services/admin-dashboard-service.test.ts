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
const WINDOW_END = new Date(NOW)
WINDOW_END.setMinutes(0, 0, 0)
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

describe('admin dashboard hour-aligned 24-hour trend', () => {
  it('fills 24 complete hourly intervals ending at the current hour boundary', async () => {
    const { hourlyTrend24h: trend } = await adminDashboardService.getInsights()

    expect(trend).toHaveLength(24)
    expect(trend.every(point => point.totalCalls === 0)).toBe(true)
    expect(trend.at(-1)?.hour).toBe(WINDOW_END.toISOString())
    expect(new Date(trend[0]!.hour).getTime() - HOUR_MS).toBe(WINDOW_END.getTime() - 24 * HOUR_MS)
    for (const point of trend) {
      const hour = new Date(point.hour)
      expect([hour.getMinutes(), hour.getSeconds(), hour.getMilliseconds()]).toEqual([0, 0, 0])
      expect(point.label).toMatch(/^\d{2}:00$/)
    }
    for (let index = 1; index < trend.length; index += 1) {
      expect(new Date(trend[index]!.hour).getTime() - new Date(trend[index - 1]!.hour).getTime()).toBe(HOUR_MS)
    }
  })

  it('counts complete hours and excludes calls outside the window or not tracked', async () => {
    const end = WINDOW_END.getTime()
    const start = end - 24 * HOUR_MS
    for (const timestamp of [
      start - 1, start, start + 1, start + HOUR_MS - 1, start + HOUR_MS,
      end - HOUR_MS, end - 1, end,
      NOW.getTime() - 1, NOW.getTime(), NOW.getTime() + 1
    ]) {
      await insertCall(timestamp)
    }
    await insertCall(end - 1, false)

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
    const end = new Date(now)
    end.setMinutes(0, 0, 0)
    vi.setSystemTime(now)
    await client.query("SELECT set_config('TimeZone', $1, false)", [timeZone])
    await insertCall(end.getTime() - 24 * HOUR_MS)
    await insertCall(end.getTime() - 1)
    await insertCall(now.getTime() - 1)

    const { hourlyTrend24h: trend } = await adminDashboardService.getInsights()

    expect(trend).toHaveLength(24)
    expect(trend.at(-1)?.hour).toBe(end.toISOString())
    expect(trend[0]?.totalCalls).toBe(1)
    expect(trend.at(-1)?.totalCalls).toBe(1)
    expect(trend.reduce((total, point) => total + point.totalCalls, 0)).toBe(2)
  })

  it('uses one snapshot time even when the query finishes in a later hour', async () => {
    await insertCall(WINDOW_END.getTime() - 1)
    const pending = adminDashboardService.getInsights()
    vi.setSystemTime(new Date(NOW.getTime() + HOUR_MS))
    const { hourlyTrend24h: trend } = await pending

    expect(trend.at(-1)?.hour).toBe(WINDOW_END.toISOString())
    expect(trend.at(-1)?.totalCalls).toBe(1)
  })

  it('keeps minute refreshes stable and advances the window only on the next hour', async () => {
    await insertCall(WINDOW_END.getTime() - 24 * HOUR_MS)
    await insertCall(WINDOW_END.getTime() + 1)
    const first = await adminDashboardService.getInsights()

    vi.setSystemTime(new Date(NOW.getTime() + 10 * 60 * 1000))
    expect(await adminDashboardService.getInsights()).toEqual(first)

    vi.setSystemTime(new Date(WINDOW_END.getTime() + HOUR_MS))
    const { hourlyTrend24h: trend } = await adminDashboardService.getInsights()
    expect(trend.at(-1)?.hour).toBe(new Date(WINDOW_END.getTime() + HOUR_MS).toISOString())
    expect(trend[0]?.totalCalls).toBe(0)
    expect(trend.at(-1)?.totalCalls).toBe(1)
    expect(trend.reduce((total, point) => total + point.totalCalls, 0)).toBe(1)
  })
})
