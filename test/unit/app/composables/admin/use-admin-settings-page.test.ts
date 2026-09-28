import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SITE_SETTINGS_DEFAULTS } from '#shared/config/site-defaults'
import { useAdminSettingsPage } from '~/composables/admin/use-admin-settings-page'

const lifecycle = vi.hoisted(() => ({ mounted: [] as Array<() => void> }))
vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onMounted: (callback: () => void) => lifecycle.mounted.push(callback) }))
const fetchMock = vi.fn()
const toast = vi.fn()
const publicCache = ref<unknown>(null)
let scope = effectScope()

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function setup() {
  const settings = scope.run(useAdminSettingsPage)!
  lifecycle.mounted.splice(0).forEach(callback => callback())
  await vi.waitFor(() => expect(settings.loading.value).toBe(false))
  fetchMock.mockClear()
  return settings
}
beforeEach(() => {
  scope = effectScope()
  lifecycle.mounted = []
  publicCache.value = null
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useNuxtData', () => ({ data: publicCache }))
  fetchMock.mockResolvedValue({ ...SITE_SETTINGS_DEFAULTS })
})
afterEach(() => { scope.stop(); vi.resetAllMocks(); vi.unstubAllGlobals() })

describe('settings submission snapshots', () => {
  it('preserves edits made while the initial read is pending', async () => {
    const read = deferred<unknown>()
    fetchMock.mockReturnValueOnce(read.promise)
    const settings = scope.run(useAdminSettingsPage)!
    lifecycle.mounted.splice(0).forEach(callback => callback())
    settings.form.siteName = 'new draft'
    await expect(settings.save()).resolves.toBe(false)
    read.resolve({ ...SITE_SETTINGS_DEFAULTS, siteName: 'server name' })
    await vi.waitFor(() => expect(settings.loading.value).toBe(false))
    expect(settings.form.siteName).toBe('new draft')
    expect(settings.changedKeys.value).toContain('siteName')
    settings.reset(['siteName'])
    expect(settings.form.siteName).toBe('server name')
  })

  it('accepts the submitted value without overwriting a newer draft or another section', async () => {
    const settings = await setup()
    const response = deferred<unknown>()
    fetchMock.mockReturnValueOnce(response.promise)
    settings.form.siteName = ' sent '
    const pending = settings.save(['siteName'])
    settings.form.siteName = 'new draft'
    settings.form.smtpHost = 'mail.draft.test'
    await expect(settings.save()).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/settings/update', { method: 'PUT', body: { siteName: ' sent ' } })
    response.resolve({ siteName: 'sent', public: { siteName: 'sent' } })
    await expect(pending).resolves.toBe(true)
    expect(settings.form.siteName).toBe('new draft')
    expect(settings.form.smtpHost).toBe('mail.draft.test')
    expect(settings.changedKeys.value).toEqual(expect.arrayContaining(['siteName', 'smtpHost']))
    expect(publicCache.value).toEqual({ siteName: 'sent' })
    settings.reset(['siteName'])
    expect(settings.form.siteName).toBe('sent')
  })

  it('clears only the Secret value that was actually submitted', async () => {
    const settings = await setup()
    const response = deferred<unknown>()
    fetchMock.mockReturnValueOnce(response.promise)
    settings.form.smtpPass = 'first-secret'
    const pending = settings.save(['smtpPass'])
    settings.form.smtpPass = 'second-secret'
    response.resolve({ smtpPass: '', secrets: { hasSmtpPass: true } })
    await pending
    expect(settings.form.smtpPass).toBe('second-secret')
    expect(settings.secrets.hasSmtpPass).toBe(true)
    expect(settings.dirty.value).toBe(true)
    fetchMock.mockResolvedValueOnce({ smtpPass: '', secrets: { hasSmtpPass: true } })
    await settings.save(['smtpPass'])
    expect(settings.form.smtpPass).toBe('')
    expect(settings.dirty.value).toBe(false)
  })

  it('does not reset dependent network drafts after a failed save', async () => {
    const settings = await setup()
    settings.form.clientIpSource = 'cloudflare'
    settings.form.trustedProxyCidrs = '192.0.2.0/24'
    fetchMock.mockRejectedValueOnce(new Error('rejected'))
    await expect(settings.save(['clientIpSource'], { resetKeys: ['trustedProxyCidrs'] })).resolves.toBe(false)
    expect(settings.form.trustedProxyCidrs).toBe('192.0.2.0/24')
    expect(settings.changedKeys.value).toContain('clientIpSource')
    expect(toast).toHaveBeenCalledWith({ title: 'rejected', color: 'error' })
  })

  it('resets dependent fields only when they have not changed since submission', async () => {
    const settings = await setup()
    const response = deferred<unknown>()
    settings.form.clientIpSource = 'cloudflare'
    settings.form.trustedProxyCidrs = '192.0.2.0/24'
    settings.form.clientIpForwardedHops = 3
    fetchMock.mockReturnValueOnce(response.promise)
    const pending = settings.save(['clientIpSource'], { resetKeys: ['trustedProxyCidrs', 'clientIpForwardedHops'] })
    settings.form.clientIpForwardedHops = 4
    response.resolve({ clientIpSource: 'cloudflare' })
    await pending
    expect(settings.form.trustedProxyCidrs).toBe(SITE_SETTINGS_DEFAULTS.trustedProxyCidrs)
    expect(settings.form.clientIpForwardedHops).toBe(4)
  })

  it('uses the captured policy for a combined write rather than committing current form values', async () => {
    const settings = await setup()
    const response = deferred<{ oauthForceBinding: boolean }>()
    const original = settings.form.oauthForceBinding
    settings.form.oauthForceBinding = !original
    const request = vi.fn(() => response.promise)
    const pending = settings.saveWith({ keys: ['oauthForceBinding'], request })
    settings.form.oauthForceBinding = original
    expect(request.mock.calls[0]?.[0].oauthForceBinding).toBe(!original)
    response.resolve({ oauthForceBinding: !original })
    await pending
    expect(settings.form.oauthForceBinding).toBe(original)
    expect(settings.changedKeys.value).toContain('oauthForceBinding')
  })

  it('keeps dependent network drafts if the selected mode changes during saving', async () => {
    const settings = await setup()
    settings.form.clientIpSource = 'cloudflare'
    settings.form.trustedProxyCidrs = '192.0.2.0/24'
    const response = deferred<unknown>()
    fetchMock.mockReturnValueOnce(response.promise)
    const pending = settings.save(['clientIpSource'], { resetKeys: ['trustedProxyCidrs'] })
    settings.form.clientIpSource = 'x_forwarded_for'
    response.resolve({ clientIpSource: 'cloudflare' })
    await pending
    expect(settings.form.trustedProxyCidrs).toBe('192.0.2.0/24')
    expect(settings.form.clientIpSource).toBe('x_forwarded_for')
  })

  it('ignores save results and feedback after scope disposal', async () => {
    const settings = await setup()
    const response = deferred<unknown>()
    fetchMock.mockReturnValueOnce(response.promise)
    settings.form.siteName = 'sent'
    const pending = settings.save(['siteName'])
    scope.stop()
    response.resolve({ siteName: 'saved', public: { siteName: 'saved' } })
    await expect(pending).resolves.toBe(false)
    expect(settings.form.siteName).toBe('sent')
    expect(publicCache.value).toBeNull()
    expect(toast).not.toHaveBeenCalled()
  })
})
