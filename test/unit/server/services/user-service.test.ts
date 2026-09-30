import type { PGlite } from '@electric-sql/pglite'
import { createTestDatabase } from '../../../helpers/database'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const testContext = vi.hoisted(() => ({
  database: null as unknown
}))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
}))

const { userService } = await import('~~/server/services/user-service')
const { adminUserService } = await import('~~/server/services/admin-user-service')

let client: PGlite

beforeAll(async () => {
  const testDatabase = await createTestDatabase()
  client = testDatabase.client
  testContext.database = testDatabase.database
})

beforeEach(async () => {
  await client.exec(`
    TRUNCATE users RESTART IDENTITY CASCADE;
    INSERT INTO users
      (role, username, email, password_hash, is_active, is_banned, banned_until)
    VALUES
      ('admin', 'admin', 'admin@example.com', 'old-admin-hash', true, false, null),
      ('user', 'user', 'user@example.com', 'old-user-hash', true, false, null),
      ('user', 'banned', 'banned@example.com', 'old-banned-hash', true, true, '2020-01-01T00:00:00Z');
  `)
})

afterAll(async () => {
  await client.close()
})

describe('user service security state', () => {
  it('keeps at least one available administrator', async () => {
    await expect(adminUserService.updateUser(1, { role: 'user' })).rejects.toMatchObject({ statusCode: 400 })

    await adminUserService.updateUser(2, { role: 'admin' })
    const demoted = await adminUserService.updateUser(1, { role: 'user' })

    expect(demoted?.role).toBe('user')
  })

  it('only clears a ban that is still expired', async () => {
    const cleared = await userService.clearExpiredBan(3)
    expect(cleared).toMatchObject({ isBanned: false, bannedUntil: null })

    const future = new Date(Date.now() + 60_000)
    await adminUserService.banUser(3, true, { bannedUntil: future })
    expect(await userService.clearExpiredBan(3)).toBeNull()
    await expect(userService.getById(3)).resolves.toMatchObject({ isBanned: true, bannedUntil: future })
  })

  it('only rolls back users that are still pending', async () => {
    await client.exec(`
      INSERT INTO users (username, email, password_hash, is_active)
      VALUES ('pending', 'pending@example.com', 'hash', false);
    `)

    expect(await userService.deletePendingUser(4)).toMatchObject({ id: 4, isActive: false })
    expect(await userService.deletePendingUser(2)).toBeNull()
    await expect(userService.getById(2)).resolves.toMatchObject({ id: 2, isActive: true })
  })
})
