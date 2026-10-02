import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SITE_SETTINGS_DEFAULTS } from '#shared/config/site-defaults'
import { createTestDatabase } from '../../../helpers/database'

const context = vi.hoisted(() => ({ database: null as unknown, email: vi.fn(), audit: vi.fn() }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
vi.mock('~~/server/utils/email', () => ({ sendVerificationEmail: context.email, sendDuplicateRegistrationEmail: context.email }))
vi.mock('~~/server/utils/request-operation-log', () => ({ addRequestOperationLog: context.audit }))
vi.mock('~~/server/utils/turnstile', () => ({ assertTurnstileForPage: async () => {} }))
vi.mock('~~/server/utils/rate-limit/identity', () => ({ canConsumeIdentityRateLimit: async () => true }))
vi.mock('~~/server/utils/request-meta', () => ({ readClientIp: () => '127.0.0.1', toClientIpRateLimitValue: (ip: string) => ip }))
vi.mock('~~/server/utils/zod', () => ({ readZodBody: async (event: { body: unknown }, schema: { parse: (value: unknown) => unknown }) => schema.parse(event.body) }))
vi.mock('~~/server/utils/password', () => ({ hashPassword: async () => 'test-hash' }))
vi.mock('~~/server/services/system-settings-service', () => ({
  systemSettingsService: { getSettings: async () => ({ ...SITE_SETTINGS_DEFAULTS, emailActivationEnabled: true, registrationMode: 'open' }) }
}))
vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
vi.stubGlobal('useRuntimeConfig', () => ({ auth: { secret: 'registration-test-secret-at-least-32-bytes' } }))
const { default: register } = await import('~~/server/api/auth/register.post')
const { registrationService } = await import('~~/server/services/registration-service')
let fixture: Awaited<ReturnType<typeof createTestDatabase>>
beforeAll(async () => { fixture = await createTestDatabase(); context.database = fixture.database })
beforeEach(async () => {
  vi.clearAllMocks()
  context.email.mockReset()
  await fixture.client.exec(`TRUNCATE users, credit_transactions RESTART IDENTITY CASCADE;
    INSERT INTO users (username, email, password_hash) VALUES ('existing', 'existing@example.com', 'hash');`)
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await fixture.client.close(); vi.unstubAllGlobals() })

describe('anonymous registration outcome', () => {
  it('keeps existing and new emails indistinguishable during delivery failure and rolls back the new user', async () => {
    context.email.mockRejectedValue(new Error('SMTP unavailable'))
    const invoke = (email: string) => register({ body: { username: 'new-user', email, password: 'ValidPassword!42' } } as never)
    expect(await invoke('existing@example.com')).toEqual({ verificationRequired: true })
    expect(await invoke('new@example.com')).toEqual({ verificationRequired: true })
    expect((await fixture.client.query('SELECT email FROM users')).rows).toEqual([{ email: 'existing@example.com' }])
    expect(context.audit).not.toHaveBeenCalled()
  })

  it('records successful registration and keeps the same anonymous response', async () => {
    await expect(register({ body: { username: 'new-user', email: 'new@example.com', password: 'ValidPassword!42' } } as never))
      .resolves.toEqual({ verificationRequired: true })
    expect(context.audit).toHaveBeenCalledOnce()
    expect((await fixture.client.query('SELECT id FROM users')).rows).toHaveLength(2)
  })

  it('keeps OAuth completion errors explicit for an authenticated pending identity', async () => {
    context.email.mockRejectedValue(new Error('SMTP unavailable'))
    await expect(registrationService.registerOauth({
      email: 'new@example.com', password: 'ValidPassword!42', lastLoginIp: null,
      identity: { provider: 'github', providerUserId: 'github-1', nickname: null, avatarUrl: null, email: null }
    }, { ...SITE_SETTINGS_DEFAULTS, registrationMode: 'open', emailActivationEnabled: true }))
      .rejects.toMatchObject({ statusCode: 503 })
    expect((await fixture.client.query('SELECT email FROM users')).rows).toEqual([{ email: 'existing@example.com' }])
  })
})
