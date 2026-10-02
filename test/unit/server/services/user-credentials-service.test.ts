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
  describe('administrator profile completion', () => {
    const input = { userId: 1, expectedTokenVersion: 0, password: 'new-password' }
    beforeEach(async () => { await fixture.client.exec("UPDATE users SET role = 'admin' WHERE id = 1") })

    it('keeps blank identity fields and returns the committed version and audit detail', async () => {
      const result = await userCredentialsService.completeAdminProfile({ ...input, username: ' ', email: '' })
      expect(result.updated).toMatchObject({ username: 'user', email: 'user@example.com', passwordHash: 'hash:new-password', tokenVersion: 1 })
      expect(result.detail).toEqual({
        previous: { username: 'user', email: 'user@example.com' },
        patch: { usernameChanged: false, emailChanged: false, passwordChanged: true }
      })
    })

    it('allows only one completion from the same authenticated version', async () => {
      let arrived = 0
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      context.hash.mockImplementation(async () => {
        if (++arrived === 2) release()
        await barrier
        return 'new-hash'
      })
      const results = await Promise.allSettled([
        userCredentialsService.completeAdminProfile(input),
        userCredentialsService.completeAdminProfile(input)
      ])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409 } })
      await expect(userCredentialsService.completeAdminProfile(input)).rejects.toMatchObject({ statusCode: 409 })
      expect(await userService.getById(1)).toMatchObject({ tokenVersion: 1 })
    })

    it.each([
      "password_hash = 'other-password'", "email = 'changed@example.com'", "username = 'renamed'",
      'token_version = 1', "role = 'user'", 'is_active = false', 'is_banned = true'
    ])('does not overwrite a concurrent change to %s during hashing', async (patch) => {
      context.hash.mockImplementationOnce(async () => {
        await fixture.client.exec(`UPDATE users SET ${patch} WHERE id = 1`)
        return 'stale-hash'
      })
      await expect(userCredentialsService.completeAdminProfile(input)).rejects.toMatchObject({ statusCode: 409 })
      expect((await userService.getById(1))?.passwordHash).not.toBe('stale-hash')
    })

    it.each(['username', 'email'] as const)('maps a concurrent %s uniqueness conflict without changing credentials', async (field) => {
      context.hash.mockImplementationOnce(async () => {
        await userService.addUser({ username: 'occupied', email: 'occupied@example.com', passwordHash: 'hash' })
        return 'stale-hash'
      })
      await expect(userCredentialsService.completeAdminProfile({ ...input, [field]: field === 'username' ? 'occupied' : 'occupied@example.com' }))
        .rejects.toMatchObject({ statusCode: 409, message: field === 'username' ? '该用户名已被占用' : '该邮箱已被注册' })
      expect(await userService.getById(1)).toMatchObject({ tokenVersion: 0, passwordHash: 'old-hash' })
    })

    it.each(["role = 'user'", 'is_active = false', 'is_banned = true'])('rejects an unauthorized administrator with %s', async (patch) => {
      await fixture.client.exec(`UPDATE users SET ${patch} WHERE id = 1`)
      await expect(userCredentialsService.completeAdminProfile(input)).rejects.toMatchObject({ statusCode: 403 })
      expect(context.hash).not.toHaveBeenCalled()
    })
  })

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
