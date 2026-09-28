import { describe, expect, it } from 'vitest'
import { createAdminHourlyTrendRows } from '~/utils/admin-hourly-trend'

const HOUR_MS = 60 * 60 * 1000

describe('admin hourly chart window', () => {
  it.each([
    '2026-09-28T20:00:00+08:00',
    '2026-10-01T00:00:00+08:00'
  ])('draws the complete previous 24 hours ending at %s', (end) => {
    const windowEnd = new Date(end).getTime()
    const windowStart = windowEnd - 24 * HOUR_MS
    const trend = Array.from({ length: 24 }, (_, index) => ({
      hour: new Date(windowStart + (index + 1) * HOUR_MS).toISOString(),
      label: '',
      totalCalls: index + 3
    }))
    const original = structuredClone(trend)

    const rows = createAdminHourlyTrendRows(trend)

    expect(rows).toHaveLength(25)
    expect(rows[0]).toEqual({
      timestamp: windowStart,
      intervalEnd: windowStart + HOUR_MS,
      totalCalls: 3
    })
    expect(rows[1]?.intervalEnd).toBe(rows[0]?.intervalEnd)
    expect(rows.at(-1)).toMatchObject({ timestamp: windowEnd, intervalEnd: windowEnd, totalCalls: 26 })
    expect(rows.slice(1).map(row => row.totalCalls)).toEqual(trend.map(point => point.totalCalls))
    expect(trend).toEqual(original)
  })

  it('keeps a zero-call first interval at zero instead of borrowing a later value', () => {
    const rows = createAdminHourlyTrendRows([
      { hour: '2026-09-27T21:00:00+08:00', label: '21:00', totalCalls: 0 },
      { hour: '2026-09-27T22:00:00+08:00', label: '22:00', totalCalls: 8 }
    ])
    expect(rows.map(row => row.totalCalls)).toEqual([0, 0, 8])
  })

  it('does not add a point when the hourly series is empty', () => {
    expect(createAdminHourlyTrendRows([])).toEqual([])
  })
})
