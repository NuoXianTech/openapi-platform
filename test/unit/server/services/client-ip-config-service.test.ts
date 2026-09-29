import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSystemSettingsDefaults } from '~~/server/config/system-settings'

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn()
}))

vi.mock('~~/server/services/system-settings-service', () => ({
  systemSettingsService: {
    getSettings: mocks.getSettings
  }
}))

function settings() {
  return {
    clientIpSource: 'x_forwarded_for',
    trustedProxyCidrs: '127.0.0.1/32',
    clientIpForwardedHops: 1
  }
}

async function loadService() {
  vi.resetModules()
  return (await import('~~/server/services/client-ip-config-service')).clientIpConfigService
}

describe('client IP configuration service', () => {
  beforeEach(() => {
    mocks.getSettings.mockReset()
    vi.spyOn(Date, 'now').mockReturnValue(1_000)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each(['success', 'failure'] as const)('preserves saved settings when an older database read ends in %s', async (outcome) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let finish!: (value: ReturnType<typeof settings>) => void
    let fail!: (error: Error) => void
    mocks.getSettings.mockReturnValueOnce(new Promise((resolve, reject) => { finish = resolve; fail = reject }))
    const service = await loadService()
    const old = service.getEffectiveConfig()
    await vi.waitFor(() => expect(mocks.getSettings).toHaveBeenCalledOnce())
    service.refreshFromSettings({ ...createSystemSettingsDefaults(), clientIpSource: 'direct' })
    if (outcome === 'success') finish(settings())
    else fail(new Error('old read failed'))
    await old
    await expect(service.getEffectiveConfig()).resolves.toMatchObject({ source: 'direct', trustedProxyCidrs: [] })
    expect(mocks.getSettings).toHaveBeenCalledOnce()
  })

  it('keeps explicit environment settings ahead of database replacements', async () => {
    const service = await loadService()
    service.configureEnvironment({ source: 'direct' })
    service.refreshFromSettings({ ...createSystemSettingsDefaults(), clientIpSource: 'x_forwarded_for', trustedProxyCidrs: '127.0.0.1/32' })
    await expect(service.getEffectiveConfig()).resolves.toMatchObject({ source: 'direct', managedBy: 'environment' })
    expect(mocks.getSettings).not.toHaveBeenCalled()
  })

  it('backs off after a database refresh failure instead of retrying on every request', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const service = await loadService()
    mocks.getSettings.mockResolvedValueOnce(settings())

    await expect(service.getEffectiveConfig()).resolves.toMatchObject({
      source: 'x_forwarded_for',
      trustedProxyCidrs: ['127.0.0.1/32']
    })

    vi.mocked(Date.now).mockReturnValue(7_000)
    mocks.getSettings.mockRejectedValueOnce(new Error('database unavailable'))

    await expect(service.getEffectiveConfig()).resolves.toMatchObject({
      source: 'x_forwarded_for',
      trustedProxyCidrs: ['127.0.0.1/32']
    })
    await service.getEffectiveConfig()

    expect(mocks.getSettings).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
