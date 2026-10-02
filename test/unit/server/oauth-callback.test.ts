import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const context = vi.hoisted(() => ({ audit: vi.fn(), session: vi.fn() }))
vi.mock('h3', () => ({
  getQuery: () => ({ code: 'verified-code', state: 'valid-state' }),
  getHeader: () => 'test-agent',
  sendRedirect: (_event: unknown, target: string) => target
}))
vi.mock('~~/server/db/client', () => ({ db: {} }))
vi.mock('~~/server/services/system-settings-service', () => ({
  systemSettingsService: { getSettings: async () => ({ siteUrl: 'https://example.com' }) }
}))
vi.mock('~~/server/services/oauth-provider-service', () => ({
  buildCallbackUrl: () => 'https://example.com/callback/openid/0',
  oauthProviderService: { getByProvider: async () => ({ isEnabled: true, clientId: 'fixture', clientSecret: 'fixture' }) }
}))
vi.mock('~~/server/utils/oauth-state', () => ({ consumeState: () => ({ mode: 'bind', returnTo: '/user/settings' }) }))
vi.mock('~~/server/utils/oauth-pending', () => ({ issuePendingOauth: vi.fn() }))
vi.mock('~~/server/utils/auth', () => ({
  getAuthUser: async () => ({ id: 1, username: 'user', role: 'user' }),
  createUserSession: context.session
}))
vi.mock('~~/server/utils/request-meta', () => ({ readClientIp: () => '127.0.0.1' }))
vi.mock('~~/server/utils/request-operation-log', () => ({ addRequestOperationLog: context.audit }))
vi.mock('~~/server/utils/oauth-providers/github', () => ({
  githubProvider: {
    exchangeCode: async () => ({ accessToken: 'unused' }),
    fetchUserInfo: async () => ({ providerUserId: 'github-1', email: null, nickname: null, avatarUrl: null })
  }
}))

const { oauthAccountService, OauthBindingError } = await import('~~/server/services/oauth-account-service')
const { handleOauthCallback } = await import('~~/server/utils/oauth-callback')

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('OAuth callback binding outcomes', () => {
  it.each(['already_bound_by_other', 'already_bound_same_provider'] as const)('maps a database binding conflict to the existing redirect: %s', async reason => {
    vi.spyOn(oauthAccountService, 'bindAccount').mockRejectedValueOnce(new OauthBindingError(reason))
    expect(await handleOauthCallback({} as never, 'github')).toBe('/user/settings?oauth_error=' + reason)
    expect(context.audit).not.toHaveBeenCalled()
    expect(context.session).not.toHaveBeenCalled()
  })

  it('uses the completed binding for audit and the success redirect', async () => {
    vi.spyOn(oauthAccountService, 'bindAccount').mockResolvedValueOnce({ id: 7, userId: 1 } as never)
    expect(await handleOauthCallback({} as never, 'github')).toBe('/user/settings?oauth_bound=github')
    expect(context.audit).toHaveBeenCalledWith({}, expect.objectContaining({ userId: 1, resourceId: 7, action: 'user.oauth.bind' }))
    expect(context.session).not.toHaveBeenCalled()
  })

  it('keeps unrelated failures on the generic callback error path', async () => {
    vi.spyOn(oauthAccountService, 'bindAccount').mockRejectedValueOnce(new Error('database unavailable'))
    expect(await handleOauthCallback({} as never, 'github')).toBe('/user/settings?oauth_error=callback_failed')
    expect(context.audit).not.toHaveBeenCalled()
  })
})
