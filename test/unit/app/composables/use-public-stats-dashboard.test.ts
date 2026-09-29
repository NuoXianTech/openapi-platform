import { computed, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePublicStatsDashboard } from '@/composables/use-public-stats-dashboard'
import type { PublicCallStatsDashboard } from '#shared/types/public-stats'

afterEach(() => vi.unstubAllGlobals())

function setup(totalCalls: number, failureCalls: number) {
  const locale = ref('zh-CN')
  const data = ref<PublicCallStatsDashboard>({
    overview: {
      totalCalls, failureCalls, successCalls: totalCalls - failureCalls,
      successRate: totalCalls ? ((totalCalls - failureCalls) / totalCalls) * 100 : 0,
      todayCalls: 0, yesterdayCalls: 0, userCount: 1, enabledTrackedApiCount: 0, trackedApiCount: 0
    },
    trend7d: [], rankingLast30d: [], generatedAt: '2026-09-30T00:00:00.000Z'
  })
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useI18n', () => ({ locale, t: (key: string, args?: Record<string, unknown>) => args?.value ?? key }))
  vi.stubGlobal('useFetch', () => ({ data, pending: ref(false), error: ref(null), refresh: vi.fn() }))
  return { dashboard: usePublicStatsDashboard(), locale, data }
}

describe('public statistics presentation', () => {
  it('does not describe zero traffic as a 100% failure rate', () => {
    const { dashboard } = setup(0, 0)
    expect(dashboard.overviewCards.value.find(card => card.key === 'successRate')?.helper).toBe('0.00%')
    expect(dashboard.overviewCards.value).toHaveLength(8)
  })

  it('calculates the failure percentage from call counts', () => {
    const { dashboard, data } = setup(200, 5)
    expect(dashboard.overviewCards.value.find(card => card.key === 'successRate')?.helper).toBe('2.50%')
    data.value.overview.totalCalls = 100
    data.value.overview.failureCalls = 30
    expect(dashboard.overviewCards.value.find(card => card.key === 'successRate')?.helper).toBe('30.00%')
  })

  it('formats compact counts using the active locale after switching language', () => {
    const { dashboard, locale } = setup(100000, 0)
    expect(dashboard.formatCompact(100000)).toBe('10万')
    locale.value = 'en-US'
    expect(dashboard.formatCompact(100000)).toBe('100K')
    expect(dashboard.formatCount(100000)).toBe('100,000')
  })
})
