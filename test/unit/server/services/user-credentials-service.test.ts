import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../../../helpers/database'

const context = vi.hoisted(() => ({ database: null as unknown, hash: vi.fn(), verify: vi.fn() }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
vi.mock('~~/server/utils/password', () => ({ hashPassword: context.hash, verifyPassword: context.verify }))
vi.mock('~~/server/services/system-settings-service', () => ({
  systemSettingsService: { getSettings: async () => ({ passwordResetEnabled: true }) }
}))
const { userCredentialsService } = await import('~~/server/services/user-credentials-service')
const { userService } = await import('~~/server/services/user-service')
const { issueVerificationTokenUrl } = await import('~~/server/utils/verification-token')
let fixture: Awaited<ReturnType<typeof createTestDatabase>>

beforeAll(async () => {
  fixture = await createTestDatabase()
  context.database = fixture.database
  vi.stubGlobal('useRuntimeConfig', () => ({ auth: { secret: 'test-credentials-secret-at-least-32-bytes' } }))
})
beforeEach(async () => {
  context.hash.mockReset().mockImplementation(async (password: string) => `hash:${password}`)
  context.verify.mockReset().mockResolvedValue(true)
  await fixture.client.exec(`TRUNCATE users RESTART IDENTITY CASCADE;
    INSERT INTO users (username, email, password_hash, is_active) VALUES ('user', 'user@example.com', 'old-hash', true);`)
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await fixture.client.close(); vi.unstubAllGlobals() })

async function token(purpose: 'reset_password' | 'change_email', email = 'user@example.com') {
  const user = (await userService.getById(1))!
  return new URL(issueVerificationTokenUrl(user, {
    siteUrl: 'https://example.com', path: 'confirm', purpose, email, expiresInMinutes: 30
  })).searchParams.get('token')!
}

describe('credential consumption through the production schema', () => {
  it('accepts only one concurrent reset with the same token', async () => {
    const resetToken = await token('reset_password')
    let arrived = 0
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    context.hash.mockImplementation(async (password: string) => {
      if (++arrived === 2) release()
      await barrier
      return `hash:${password}`
    })
    const results = await Promise.allSettled(['first-password', 'second-password'].map(newPassword =>
      userCredentialsService.resetPassword({ userId: 1, token: resetToken, newPassword })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 400 } })
    expect(await userService.getById(1)).toMatchObject({ tokenVersion: 1 })
    await expect(userCredentialsService.resetPassword({ userId: 1, token: resetToken, newPassword: 'replay-password' }))
      .rejects.toMatchObject({ statusCode: 400 })
  })

  it.each(['email', 'token_version'])('rejects a reset when %s changes during hashing', async (field) => {
    const resetToken = await token('reset_password')
    context.hash.mockImplementationOnce(async () => {
      await fixture.client.exec(field === 'email'
        ? "UPDATE users SET email = 'changed@example.com' WHERE id = 1"
        : 'UPDATE users SET token_version = token_version + 1 WHERE id = 1')
      return 'stale-hash'
    })
    await expect(userCredentialsService.resetPassword({ userId: 1, token: resetToken, newPassword: 'new-password' }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(await userService.getById(1)).toMatchObject({ passwordHash: 'old-hash' })
  })

  it('does not overwrite credentials changed after the old password was verified', async () => {
    context.hash.mockImplementationOnce(async () => {
      await fixture.client.exec("UPDATE users SET password_hash = 'admin-reset', token_version = 1 WHERE id = 1")
      return 'stale-hash'
    })
    await expect(userCredentialsService.changePassword(1, 'old-password', 'new-password'))
      .rejects.toMatchObject({ statusCode: 409 })
    expect(await userService.getById(1)).toMatchObject({ passwordHash: 'admin-reset', tokenVersion: 1 })
  })

  it('changes a password and invalidates old sessions together', async () => {
    expect(await userCredentialsService.changePassword(1, 'old-password', 'new-password'))
      .toMatchObject({ passwordHash: 'hash:new-password', tokenVersion: 1 })
  })

  it('accepts only one of two email confirmations issued for the same old address', async () => {
    const first = await token('change_email', 'first@example.com')
    const second = await token('change_email', 'second@example.com')
    const get = userService.getById.bind(userService)
    let arrived = 0
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(userService, 'getById').mockImplementation(async (id) => {
      const row = await get(id)
      if (++arrived === 2) release()
      await barrier
      return row
    })
    const results = await Promise.allSettled([first, second].map(value => userCredentialsService.confirmEmailChange(1, value)))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 400 } })
  })

  it('maps a real email uniqueness conflict and preserves the old credential', async () => {
    const changeToken = await token('change_email', 'occupied@example.com')
    await userService.addUser({ username: 'other', email: 'occupied@example.com', passwordHash: 'hash' })
    await expect(userCredentialsService.confirmEmailChange(1, changeToken)).rejects.toMatchObject({ statusCode: 409 })
    expect(await userService.getById(1)).toMatchObject({ email: 'user@example.com' })
  })
})
