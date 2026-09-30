import type { PGlite } from '@electric-sql/pglite'
import { createTestDatabase } from '../../../helpers/database'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const testContext = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
}))

const { adminUserService } = await import('~~/server/services/admin-user-service')
let client: PGlite

beforeAll(async () => {
  const testDatabase = await createTestDatabase()
  client = testDatabase.client
  testContext.database = testDatabase.database
})

beforeEach(async () => {
  await client.exec(`
    TRUNCATE users, credit_transactions, operation_logs RESTART IDENTITY CASCADE;
    INSERT INTO users (username, email, credits, password_hash, is_active, created_at) VALUES
      ('zero', 'zero@example.com', 0, 'hash', true, '2026-01-01T00:00:00Z'),
      ('five', 'five@example.com', 5, 'hash', true, '2026-01-02T00:00:00Z'),
      ('ten', 'ten@example.com', 10, 'hash', true, '2026-01-03T00:00:00Z');
  `)
})

afterAll(async () => client.close())

describe('admin user service', () => {
  it.each(['active', 'pending', 'dead_letter'])('preserves a user and their %s reservation when deletion is requested', async (status) => {
    await client.query(`INSERT INTO api_credit_reservations (user_id, api_key_id, route_id, request_id, amount, status)
      VALUES (2, 1, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 3, $1)`, [status])
    await expect(adminUserService.deleteUser(2)).rejects.toMatchObject({
      statusCode: 409, data: { code: 'USER_HAS_CREDIT_RESERVATIONS' }
    })
    expect((await client.query('SELECT id FROM users WHERE id = 2')).rows).toHaveLength(1)
    expect((await client.query('SELECT status FROM api_credit_reservations')).rows).toEqual([{ status }])
    expect((await client.query('SELECT id FROM credit_transactions')).rows).toHaveLength(0)
  })

  it('allows deletion once no unsettled reservation remains and preserves the ledger', async () => {
    await client.exec("INSERT INTO credit_transactions (user_id, amount, balance_after, reason) VALUES (2, 5, 5, 'signup_bonus')")
    expect(await adminUserService.deleteUser(2)).toMatchObject({ id: 2 })
    expect((await client.query('SELECT id FROM users WHERE id = 2')).rows).toHaveLength(0)
    expect((await client.query('SELECT user_id FROM credit_transactions')).rows).toEqual([{ user_id: 2 }])
  })

  it('filters users with a positive credit balance', async () => {
    const result = await adminUserService.list({ creditBalance: 'positive' })

    expect(result.total).toBe(2)
    expect(result.items.map(item => item.username)).toEqual(['ten', 'five'])
  })

  it('filters users with a zero credit balance', async () => {
    const result = await adminUserService.list({ creditBalance: 'zero' })

    expect(result.total).toBe(1)
    expect(result.items.map(item => item.username)).toEqual(['zero'])
  })
})
