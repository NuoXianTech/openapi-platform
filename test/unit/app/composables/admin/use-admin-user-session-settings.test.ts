import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SITE_SETTINGS_DEFAULTS } from '#shared/config/site-defaults'
import { useAdminUserSessionSettings } from '~/composables/admin/use-admin-user-session-settings'

const lifecycle = vi.hoisted(() => ({ mounted: [] as Array<() => void> }))
vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onMounted: (callback: () => void) => lifecycle.mounted.push(callback) }))
const fetchMock = vi.fn()
const toast = vi.fn()
let scope = effectScope()
let rows = providerRows()
let readError: Error | null = null
function providerRows() {
  return ['github', 'qq'].map(provider => ({
    provider, clientId: `${provider}-old`, clientSecret: '***', isEnabled: true,
    displayName: provider, icon: '', scopes: [], callbackUrl: `https://site.test/${provider}`,
    authorizeUrl: '', tokenUrl: '', userInfoUrl: ''
  }))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function setup() {
  const settings = scope.run(useAdminUserSessionSettings)!
  lifecycle.mounted.splice(0).forEach(callback => callback())
  await vi.waitFor(() => expect(settings.isOauthReady.value).toBe(true))
  return settings
}
beforeEach(() => {
  scope = effectScope()
  lifecycle.mounted = []
  rows = providerRows()
  readError = null
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useCopyFeedback', () => ({ copyText: vi.fn() }))
  fetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/admin/settings/get') return { ...SITE_SETTINGS_DEFAULTS }
    if (readError) throw readError
    return rows.map(row => ({ ...row }))
  })
})
afterEach(() => { scope.stop(); vi.resetAllMocks(); vi.unstubAllGlobals() })

describe('combined OAuth settings editing', () => {
  it('preserves newer policy, provider and Secret drafts across save and refresh', async () => {
    const settings = await setup()
    const response = deferred<unknown>()
    const originalPolicy = settings.form.oauthForceBinding
    settings.form.oauthForceBinding = !originalPolicy
    const form = settings.getForm('github')
    form.clientId = 'sent-client'
    form.clientSecret = 'sent-secret'
    fetchMock.mockReturnValueOnce(response.promise)
    const pending = settings.saveOauthSettings()
    expect(fetchMock.mock.calls.at(-1)?.[1].body).toMatchObject({ oauthForceBinding: !originalPolicy, providers: expect.arrayContaining([expect.objectContaining({ clientId: 'sent-client', clientSecret: 'sent-secret' })]) })
    settings.form.oauthForceBinding = originalPolicy
    form.clientId = 'new-client-draft'
    form.clientSecret = 'new-secret-draft'
    rows[0]!.clientId = 'sent-client'
    response.resolve({ oauthForceBinding: !originalPolicy, providers: rows })
    await pending
    expect(settings.form.oauthForceBinding).toBe(originalPolicy)
    expect(form.clientId).toBe('new-client-draft')
    expect(form.clientSecret).toBe('new-secret-draft')
    expect(settings.changedKeys.value).toContain('oauthForceBinding')
    expect(settings.isOauthDirty.value).toBe(true)
  })

  it('reports refresh failure separately after accepting a successful save', async () => {
    const settings = await setup()
    settings.getForm('github').clientId = 'saved-client'
    rows[0]!.clientId = 'saved-client'
    fetchMock.mockResolvedValueOnce({ oauthForceBinding: settings.form.oauthForceBinding, providers: rows })
    readError = new Error('refresh failed')
    await settings.saveOauthSettings()
    expect(settings.isOauthDirty.value).toBe(false)
    expect(toast.mock.calls.map(call => call[0].color)).toEqual(['success', 'error'])
    expect(toast.mock.calls[1]?.[0].title).toBe('refresh failed')
  })

  it('preserves provider drafts during a manual refresh and does not clear a typed Secret', async () => {
    const settings = await setup()
    const form = settings.getForm('github')
    form.clientId = 'draft-client'
    form.clientSecret = 'draft-secret'
    rows[0]!.clientId = 'server-changed'
    await settings.refresh()
    expect(form.clientId).toBe('draft-client')
    expect(form.clientSecret).toBe('draft-secret')
    expect(settings.isOauthDirty.value).toBe(true)
  })

  it('does not accept or refresh an OAuth result after scope disposal', async () => {
    const settings = await setup()
    const response = deferred<unknown>()
    settings.getForm('github').clientId = 'sent'
    fetchMock.mockReturnValueOnce(response.promise)
    const pending = settings.saveOauthSettings()
    const calls = fetchMock.mock.calls.length
    scope.stop()
    response.resolve({ oauthForceBinding: settings.form.oauthForceBinding, providers: rows })
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(calls)
    expect(toast).not.toHaveBeenCalled()
  })
})
