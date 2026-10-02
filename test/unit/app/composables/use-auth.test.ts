import { effectScope, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser, UserProfile } from '#shared/types/auth'

const currentUser: AuthUser = {
  id: 1, username: 'user', displayName: 'Before', email: 'user@example.com',
  avatarUrl: '', role: 'user', locale: 'en-US'
}
const profileData: UserProfile = {
  ...currentUser, displayName: 'After', emailVerifiedAt: null, createdAt: '2026-01-01T00:00:00Z'
}
const fetchMock = vi.fn()
const toast = vi.fn()
let auth: ReturnType<typeof import('~/composables/use-auth').useAuth>
let makeAuth: typeof import('~/composables/use-auth').useAuth
let scope = effectScope()
let locale: Ref<string>
const setLocale = vi.fn()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  scope = effectScope()
  const state = new Map<string, Ref>([['auth-user', ref({ ...currentUser })], ['auth-loading', ref(false)]])
  locale = ref('en-US')
  setLocale.mockImplementation(async (value: string) => { locale.value = value })
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!state.has(key)) state.set(key, ref(init()))
    return state.get(key)
  })
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key, locale, setLocale }))
  makeAuth = (await import('~/composables/use-auth')).useAuth
  auth = makeAuth()
  vi.stubGlobal('useAuth', () => makeAuth())
})
afterEach(() => { scope.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function profileSettings() {
  const { useUserProfileSettings } = await import('~/composables/user/use-user-profile-settings')
  return scope.run(() => useUserProfileSettings())!
}

describe('account snapshot reads', () => {
  it('deduplicates ordinary reads across callers and preserves the five-minute freshness window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    const pending = deferred<AuthUser>()
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValue(currentUser)
    const first = auth.fetchMe()
    const second = makeAuth().fetchMe()
    expect(fetchMock).toHaveBeenCalledOnce()
    pending.resolve(currentUser)
    await Promise.all([first, second])
    await auth.fetchMe()
    expect(fetchMock).toHaveBeenCalledOnce()
    now.mockReturnValue(1_300_001)
    await auth.fetchMe()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('forces a new read and rejects a late response from the superseded request', async () => {
    const old = deferred<AuthUser>()
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...currentUser, displayName: 'New' })
    const pending = auth.fetchMe()
    const oldSignal = fetchMock.mock.calls[0]![1].signal as AbortSignal
    await auth.fetchMe(true)
    expect(oldSignal.aborted).toBe(true)
    old.resolve(currentUser)
    await pending
    expect(auth.user.value?.displayName).toBe('New')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not clear the current account or loading state when a superseded read fails', async () => {
    const old = deferred<AuthUser>()
    const next = deferred<AuthUser>()
    fetchMock.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    const first = auth.fetchMe()
    const second = auth.fetchMe(true)
    old.reject({ statusCode: 401 })
    await first
    expect(auth.user.value).toEqual(currentUser)
    expect(auth.loading.value).toBe(true)
    next.resolve(currentUser)
    await second
    expect(auth.loading.value).toBe(false)
  })

  it('preserves the account on infrastructure errors and clears it on authentication failure', async () => {
    fetchMock.mockRejectedValueOnce(new Error('database unavailable')).mockRejectedValueOnce({ statusCode: 403 })
    await expect(auth.fetchMe(true)).rejects.toThrow('database unavailable')
    expect(auth.user.value).toEqual(currentUser)
    expect(auth.loading.value).toBe(false)
    await expect(auth.fetchMe(true)).resolves.toBeNull()
    expect(auth.user.value).toBeNull()
  })

  it.each(['login', 'logout'] as const)('prevents a pending read from undoing %s', async (operation) => {
    const pending = deferred<AuthUser>()
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...currentUser, id: 2 })
    const reading = auth.fetchMe(true)
    if (operation === 'login') await auth.login({ username: 'second', password: 'fixture' })
    else await auth.logout()
    pending.resolve(currentUser)
    await reading
    expect(auth.user.value?.id ?? null).toBe(operation === 'login' ? 2 : null)
    expect(auth.loading.value).toBe(false)
  })

  it('does not let forced refresh cancel an in-progress login', async () => {
    const login = deferred<AuthUser>()
    fetchMock.mockReturnValueOnce(login.promise).mockRejectedValueOnce({ statusCode: 401 })
    const signingIn = auth.login({ username: 'second', password: 'fixture' })
    await auth.fetchMe(true)
    login.resolve({ ...currentUser, id: 2 })
    await signingIn
    expect(auth.user.value?.id).toBe(2)
  })
})

describe('account writes and identity ownership', () => {
  it.each(['success', 'error'] as const)('ignores an old preference %s after logout and a different login', async (outcome) => {
    const old = deferred<{ locale: string }>()
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(null).mockResolvedValueOnce({ ...currentUser, id: 2 })
    const saving = auth.updateLocalePreference('zh-CN')
    await auth.logout()
    await auth.login({ username: 'second', password: 'fixture' })
    if (outcome === 'success') old.resolve({ locale: 'zh-CN' })
    else old.reject(new Error('late error'))
    await expect(saving).resolves.toBeUndefined()
    expect(auth.user.value).toMatchObject({ id: 2, locale: 'en-US' })
  })

  it('binds preference writes to the session generation even when the same user logs in again', async () => {
    const old = deferred<{ locale: string }>()
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(currentUser)
    const saving = auth.updateLocalePreference('zh-CN')
    await auth.login({ username: currentUser.username, password: 'fixture' })
    old.resolve({ locale: 'zh-CN' })
    await expect(saving).resolves.toBeUndefined()
    expect(auth.user.value?.locale).toBe('en-US')
  })

  it('invalidates reads started before and during a preference write', async () => {
    const before = deferred<AuthUser>()
    const saving = deferred<{ locale: string }>()
    const during = deferred<AuthUser>()
    fetchMock.mockReturnValueOnce(before.promise).mockReturnValueOnce(saving.promise).mockReturnValueOnce(during.promise)
    const a = auth.fetchMe()
    const write = auth.updateLocalePreference('zh-CN')
    const b = auth.fetchMe(true)
    saving.resolve({ locale: 'zh-CN' })
    await expect(write).resolves.toBe('zh-CN')
    before.resolve(currentUser)
    during.resolve(currentUser)
    await Promise.all([a, b])
    expect(auth.user.value?.locale).toBe('zh-CN')
    expect(fetchMock.mock.calls[0]![1].signal.aborted).toBe(true)
    expect(fetchMock.mock.calls[2]![1].signal.aborted).toBe(true)
  })

  it('ignores a pending write when a current auth read discovers a different user', async () => {
    const pending = deferred<{ locale: string }>()
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...currentUser, id: 2 })
    const saving = auth.updateLocalePreference('zh-CN')
    await auth.fetchMe(true)
    pending.resolve({ locale: 'zh-CN' })
    await expect(saving).resolves.toBeUndefined()
    expect(auth.user.value).toMatchObject({ id: 2, locale: 'en-US' })
  })

  it('updates only the committed profile field while preserving a concurrent locale change', async () => {
    const pending = deferred<UserProfile>()
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ locale: 'zh-CN' })
    const saving = auth.updateProfile(' After ')
    await auth.updateLocalePreference('zh-CN')
    pending.resolve(profileData)
    await saving
    expect(fetchMock.mock.calls[0]![1].body).toEqual({ displayName: 'After' })
    expect(auth.user.value).toMatchObject({ displayName: 'After', locale: 'zh-CN', role: 'user' })
  })
})

describe('profile settings completion', () => {
  it('uses committed profile data and blocks both pre-save reads from restoring old fields', async () => {
    const authRead = deferred<AuthUser>()
    const profileRead = deferred<UserProfile>()
    fetchMock.mockReturnValueOnce(authRead.promise).mockReturnValueOnce(profileRead.promise).mockResolvedValueOnce(profileData)
    const profile = await profileSettings()
    const a = auth.fetchMe()
    const b = profile.loadProfile()
    await profile.updateProfile('After')
    authRead.resolve(currentUser)
    profileRead.resolve({ ...profileData, displayName: 'Before' })
    await Promise.all([a, b])
    expect(profile.profile.value?.displayName).toBe('After')
    expect(auth.user.value?.displayName).toBe('After')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(toast).toHaveBeenCalledExactlyOnceWith({ title: 'user.settings.profile.updated', color: 'success' })
  })

  it('does not misreport a successful profile save as failed because of an unnecessary refresh', async () => {
    fetchMock.mockResolvedValueOnce(profileData).mockRejectedValue(new Error('refresh unavailable'))
    const profile = await profileSettings()
    await expect(profile.updateProfile('After')).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(profile.profile.value?.displayName).toBe('After')
  })

  it('preserves the saved profile and propagates a current write failure for retry', async () => {
    fetchMock.mockResolvedValueOnce(profileData).mockRejectedValueOnce(new Error('write failed'))
    const profile = await profileSettings()
    await profile.loadProfile()
    await expect(profile.updateProfile('Unsaved')).rejects.toThrow('write failed')
    expect(profile.profile.value).toEqual(profileData)
    expect(toast).not.toHaveBeenCalled()
  })

  it.each(['dispose', 'switch'] as const)('does not refill or notify an obsolete profile view after %s', async (change) => {
    const pending = deferred<UserProfile>()
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...currentUser, id: 2 })
    const profile = await profileSettings()
    const saving = profile.updateProfile('After')
    if (change === 'dispose') scope.stop()
    else await auth.login({ username: 'second', password: 'fixture' })
    pending.resolve(profileData)
    await saving
    expect(profile.profile.value).toBeNull()
    expect(toast).not.toHaveBeenCalled()
    expect(auth.user.value?.displayName).toBe(change === 'dispose' ? 'After' : 'Before')
  })

  it('does not roll back the new account language when the old preference write fails', async () => {
    const pending = deferred<{ locale: string }>()
    fetchMock.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ ...currentUser, id: 2 })
    const profile = await profileSettings()
    const saving = profile.updateLanguagePreference('zh-CN')
    await new Promise(resolve => setImmediate(resolve))
    await auth.login({ username: 'second', password: 'fixture' })
    setLocale.mockClear()
    pending.reject(new Error('old account failure'))
    await saving
    expect(setLocale).not.toHaveBeenCalled()
    expect(profile.profile.value).toBeNull()
    expect(toast).not.toHaveBeenCalled()
  })
})
