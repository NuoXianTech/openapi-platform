import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SITE_SETTINGS_DEFAULTS } from '#shared/config/site-defaults'
import type { SystemSettings } from '#shared/types/site-settings'
import { createTestDatabase } from '../../../helpers/database'

const context = vi.hoisted(() => ({ database: null as unknown, email: vi.fn(), settings: {} as SystemSettings }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
vi.mock('~~/server/utils/email', () => ({ sendVerificationEmail: context.email, sendDuplicateRegistrationEmail: context.email }))
vi.mock('~~/server/services/system-settings-service', () => ({
  systemSettingsService: { getSettings: async () => context.settings }
}))
vi.stubGlobal('useRuntimeConfig', () => ({ auth: { secret: 'oauth-registration-test-secret-at-least-32-bytes' } }))

const { registrationService } = await import('~~/server/services/registration-service')
const { oauthAccountService } = await import('~~/server/services/oauth-account-service')
const { userService } = await import('~~/server/services/user-service')
const verification = await import('~~/server/utils/verification-token')
let fixture: Awaited<ReturnType<typeof createTestDatabase>>
const identity = { provider: 'github' as const, providerUserId: 'github-42', nickname: 'New User!', avatarUrl: null, email: 'profile@example.com' }
const input = () => ({ email: 'confirmed@example.com', password: 'ValidPassword!42', identity, lastLoginIp: '127.0.0.1' })
const register = () => registrationService.registerOauth(input(), context.settings)

beforeAll(async () => { fixture = await createTestDatabase(); context.database = fixture.database })
beforeEach(async () => {
  context.email.mockReset()
  context.settings = {
    ...SITE_SETTINGS_DEFAULTS, registrationMode: 'open', emailActivationEnabled: false,
    defaultRegisterCredits: 25, siteUrl: 'https://example.com'
  }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await fixture.client.exec('TRUNCATE users, credit_transactions RESTART IDENTITY CASCADE')
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await fixture.client.close(); vi.unstubAllGlobals() })

async function expectNoCreatedAccount() {
  expect((await fixture.client.query('SELECT id FROM users')).rows).toEqual([])
  expect((await fixture.client.query('SELECT id FROM oauth_accounts')).rows).toEqual([])
  expect((await fixture.client.query('SELECT id FROM credit_transactions')).rows).toEqual([])
}

describe('OAuth registration completion', () => {
  it('creates, binds and activates the user, granting the signup bonus once', async () => {
    const result = await register()
    expect(result.verificationRequired).toBe(false)
    expect(result.linkedAccount).toMatchObject({ userId: result.user.id, provider: 'github', providerUserId: 'github-42' })
    expect(await userService.getById(result.user.id)).toMatchObject({
      username: 'newuser', email: 'confirmed@example.com', isActive: true, credits: 25
    })
    expect(context.email).not.toHaveBeenCalled()
    await userService.activateUser(result.user.id)
    expect((await fixture.client.query('SELECT amount, reason FROM credit_transactions')).rows)
      .toEqual([{ amount: 25, reason: 'signup_bonus' }])
  })

  it('retains a pending user and binding until verification, emailing the submitted address', async () => {
    context.settings.emailActivationEnabled = true
    const result = await register()
    expect(result.verificationRequired).toBe(true)
    expect(await userService.getById(result.user.id)).toMatchObject({ isActive: false, credits: 0, emailVerifiedAt: null })
    expect(await oauthAccountService.findByProviderUserId('github', 'github-42')).toMatchObject({ userId: result.user.id })
    expect(context.email).toHaveBeenCalledWith('confirmed@example.com', expect.stringContaining('https://example.com/verify-email?'))
  })

  it.each(['activation throws', 'activation returns no user', 'email', 'token'])('compensates the user and binding after %s failure', async failure => {
    if (failure === 'activation throws') vi.spyOn(userService, 'activateUser').mockRejectedValueOnce(new Error('activation failed'))
    if (failure === 'activation returns no user') vi.spyOn(userService, 'activateUser').mockResolvedValueOnce(null)
    if (failure === 'email' || failure === 'token') context.settings.emailActivationEnabled = true
    if (failure === 'email') context.email.mockRejectedValueOnce(new Error('SMTP unavailable'))
    if (failure === 'token') vi.spyOn(verification, 'issueVerificationTokenUrl').mockImplementationOnce(() => { throw new Error('signing failed') })
    await expect(register()).rejects.toMatchObject({ statusCode: 503 })
    await expectNoCreatedAccount()
  })

  it('compensates a newly created user when another user wins the binding race', async () => {
    const winner = await userService.addUser({ username: 'winner', email: 'winner@example.com', passwordHash: 'unused', isActive: true })
    const bind = oauthAccountService.bindAccount.bind(oauthAccountService)
    vi.spyOn(oauthAccountService, 'bindAccount').mockImplementationOnce(async (binding) => {
      await bind({ ...binding, userId: winner.id })
      return bind(binding)
    })
    await expect(register()).rejects.toMatchObject({ statusCode: 409, reason: 'already_bound_by_other' })
    expect((await fixture.client.query('SELECT id FROM users')).rows).toEqual([{ id: winner.id }])
    expect(await oauthAccountService.findByProviderUserId('github', 'github-42')).toMatchObject({ userId: winner.id })
    expect((await fixture.client.query('SELECT id FROM credit_transactions')).rows).toEqual([])
  })

  it('keeps the original failure explicit when compensation also fails', async () => {
    context.settings.emailActivationEnabled = true
    context.email.mockRejectedValueOnce(new Error('SMTP unavailable'))
    vi.spyOn(userService, 'deletePendingUser').mockRejectedValueOnce(new Error('database unavailable'))
    await expect(register()).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('验证邮件发送失败') })
    const pending = await userService.findByEmail('confirmed@example.com')
    expect(pending).toMatchObject({ isActive: false, credits: 0 })
    expect(console.error).toHaveBeenCalledWith('[registration] rollback failed', expect.objectContaining({ userId: pending?.id }))
  })

  it.each(['forced binding', 'closed', 'invite', 'email domain'])('rejects %s policy before creating an account', async policy => {
    if (policy === 'forced binding') context.settings.oauthForceBinding = true
    if (policy === 'closed') context.settings.registrationMode = 'closed'
    if (policy === 'invite') {
      context.settings.registrationMode = 'invite'
      context.settings.registrationInviteCode = 'required-code'
    }
    if (policy === 'email domain') {
      context.settings.registerEmailFilterMode = 'whitelist'
      context.settings.registerEmailFilterList = 'allowed.example'
    }
    await expect(register()).rejects.toMatchObject({ statusCode: 403 })
    await expectNoCreatedAccount()
  })

  it('never silently links a provider identity to an existing email', async () => {
    const existing = await userService.addUser({ username: 'existing', email: input().email, passwordHash: 'unused', isActive: true })
    await expect(register()).rejects.toMatchObject({ statusCode: 409, message: '该邮箱已注册，请改用「绑定已有账号」' })
    expect((await fixture.client.query('SELECT id FROM users')).rows).toEqual([{ id: existing.id }])
    expect(await oauthAccountService.findByProviderUserId('github', 'github-42')).toBeNull()
  })

  it('rejects an already bound identity without creating another user', async () => {
    const existing = await userService.addUser({ username: 'existing', email: 'existing@example.com', passwordHash: 'unused', isActive: true })
    await oauthAccountService.bindAccount({ ...identity, userId: existing.id })
    await expect(register()).rejects.toMatchObject({ statusCode: 409 })
    expect((await fixture.client.query('SELECT id FROM users')).rows).toEqual([{ id: existing.id }])
  })

  it('derives another username when the provider nickname is already in use', async () => {
    await userService.addUser({ username: 'newuser', email: 'existing@example.com', passwordHash: 'unused', isActive: true })
    const result = await register()
    expect(result.user.username).toMatch(/^newuser_[0-9a-f]{4}$/)
  })

  it('rejects a requested duplicate username', async () => {
    await userService.addUser({ username: 'existing', email: 'existing@example.com', passwordHash: 'unused', isActive: true })
    await expect(registrationService.registerOauth({ ...input(), username: 'existing' }, context.settings))
      .rejects.toMatchObject({ statusCode: 409, message: '该用户名已被占用' })
    expect(await userService.findByEmail(input().email)).toBeNull()
  })
})
