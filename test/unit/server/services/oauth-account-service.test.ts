import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../../../helpers/database'
import { hashPassword } from '~~/server/utils/password'

const testContext = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
}))

const { oauthAccountService } = await import('~~/server/services/oauth-account-service')
const { userService } = await import('~~/server/services/user-service')
let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let passwordHash: string
const identity = { provider: 'github' as const, providerUserId: 'github-1', nickname: 'Profile', email: null, avatarUrl: null }
const bindWithPassword = (identifier = 'first', password = 'ValidPassword!42') =>
  oauthAccountService.bindWithPassword({ identifier, password, identity, lastLoginIp: '127.0.0.1' })

beforeAll(async () => {
  fixture = await createTestDatabase()
  testContext.database = fixture.database
  passwordHash = await hashPassword('ValidPassword!42')
})
beforeEach(async () => {
  await fixture.client.exec('TRUNCATE users RESTART IDENTITY CASCADE')
  for (const username of ['first', 'second']) {
    await userService.addUser({ username, email: username + '@example.com', passwordHash, isActive: true })
  }
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => fixture.client.close())

describe('oauth account service', () => {
  it('updates profile data without changing the binding owner', async () => {
    const created = await oauthAccountService.bindAccount({
      userId: 1,
      provider: 'github',
      providerUserId: 'github-1',
      nickname: 'old'
    })
    const updated = await oauthAccountService.bindAccount({
      userId: 1,
      provider: 'github',
      providerUserId: 'github-1',
      nickname: 'new'
    })

    expect(updated).toMatchObject({ id: created?.id, userId: 1, nickname: 'new' })
  })

  it('never transfers an existing provider identity to another user', async () => {
    await oauthAccountService.bindAccount({
      userId: 1,
      provider: 'github',
      providerUserId: 'github-1'
    })

    await expect(oauthAccountService.bindAccount({
      userId: 2,
      provider: 'github',
      providerUserId: 'github-1'
    })).rejects.toMatchObject({ statusCode: 409, reason: 'already_bound_by_other' })
    await expect(oauthAccountService.findByProviderUserId('github', 'github-1'))
      .resolves.toMatchObject({ userId: 1 })
  })

  it('rejects a second identity for the same user and provider', async () => {
    await oauthAccountService.bindAccount({
      userId: 1,
      provider: 'github',
      providerUserId: 'github-1'
    })

    await expect(oauthAccountService.bindAccount({
      userId: 1,
      provider: 'github',
      providerUserId: 'github-2'
    })).rejects.toMatchObject({ statusCode: 409, reason: 'already_bound_same_provider' })
  })
})

describe('password-authorized OAuth binding', () => {
  it.each(['first', 'FIRST@example.com'])('authenticates and binds using %s', async identifier => {
    const result = await bindWithPassword(identifier)
    expect(result.user).toMatchObject({ id: 1, username: 'first' })
    expect(await oauthAccountService.findByProviderUserId('github', 'github-1'))
      .toMatchObject({ userId: 1, lastLoginIp: '127.0.0.1', nickname: 'Profile' })
  })

  it.each([['missing', 'ValidPassword!42'], ['first', 'wrong']])('keeps credential failures indistinguishable: %s', async (identifier, password) => {
    await expect(bindWithPassword(identifier, password)).rejects.toMatchObject({ statusCode: 401, message: '账号或密码错误' })
    expect(await oauthAccountService.findByProviderUserId('github', 'github-1')).toBeNull()
  })

  it.each(['inactive', 'banned'])('does not bind an %s account', async state => {
    await fixture.client.exec(state === 'inactive'
      ? 'UPDATE users SET is_active = false WHERE id = 1'
      : 'UPDATE users SET is_banned = true, banned_until = NULL WHERE id = 1')
    await expect(bindWithPassword()).rejects.toMatchObject({ statusCode: 403 })
    expect(await oauthAccountService.findByProviderUserId('github', 'github-1')).toBeNull()
  })

  it('clears an expired ban before binding', async () => {
    await fixture.client.exec("UPDATE users SET is_banned = true, banned_until = now() - interval '1 hour' WHERE id = 1")
    await bindWithPassword()
    expect(await userService.getById(1)).toMatchObject({ isBanned: false, bannedUntil: null })
    expect(await oauthAccountService.findByProviderUserId('github', 'github-1')).toMatchObject({ userId: 1 })
  })

  it('preserves another user’s ownership after valid password authentication', async () => {
    await oauthAccountService.bindAccount({ ...identity, userId: 2 })
    await expect(bindWithPassword()).rejects.toMatchObject({ statusCode: 409, reason: 'already_bound_by_other' })
    expect(await oauthAccountService.findByProviderUserId('github', 'github-1')).toMatchObject({ userId: 2 })
  })
})
