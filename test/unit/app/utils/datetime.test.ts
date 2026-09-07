import { afterEach, describe, expect, it, vi } from 'vitest'
import { dateTimeLocalToCalendar, formatTrendHour } from '~/utils/datetime'

afterEach(() => vi.unstubAllEnvs())

describe('datetime utilities', () => {
  it('parses valid local date-time values without normalizing invalid dates', () => {
    expect(dateTimeLocalToCalendar('2026-08-07T12:30')?.toString()).toBe('2026-08-07T12:30:00')
    expect(dateTimeLocalToCalendar('2026-02-30T12:30')).toBeUndefined()
    expect(dateTimeLocalToCalendar('2026-08-07 12:30:00')).toBeUndefined()
  })

  it.each([
    ['Asia/Shanghai', '18:37'],
    ['America/New_York', '06:37'],
    ['Asia/Kathmandu', '16:22']
  ])('formats hourly chart labels in the viewer timezone %s', (timeZone, expected) => {
    vi.stubEnv('TZ', timeZone)
    expect(formatTrendHour('2026-09-07T10:37:42.123Z', 'en-US')).toBe(expected)
    expect(formatTrendHour('2026-09-07T10:37:42.123Z', 'zh-CN')).toBe(expected)
  })

  it('uses 00 at local midnight and safely rejects invalid timestamps', () => {
    vi.stubEnv('TZ', 'Asia/Shanghai')
    expect(formatTrendHour('2026-09-07T16:05:00.000Z', 'en-US')).toBe('00:05')
    expect(formatTrendHour('invalid')).toBe('')
  })
})
