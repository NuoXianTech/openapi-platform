import type { PGlite } from '@electric-sql/pglite'
import { createTestDatabase } from '../../../helpers/database'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DistributedLeaseClient } from '~~/server/utils/distributed-lease'

const testContext = vi.hoisted(() => ({
  database: null as unknown,
  leaseClient: null as DistributedLeaseClient | null,
  leaseError: null as Error | null,
  required: false
}))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
}))

vi.mock('~~/server/utils/redis', async (original) => ({
  ...await original<typeof import('~~/server/utils/redis')>(),
  initializeRedis: async () => {
    if (testContext.leaseError) throw testContext.leaseError
    return testContext.leaseClient
  },
  getRedisConfig: () => ({ keyPrefix: 'test:', required: testContext.required })
}))

const { creditService } = await import('~~/server/services/credit-service')
let client: PGlite
const routeId = '00000000-0000-4000-8000-000000000001'

function reserve(amount: number) {
  return creditService.reserve({
    userId: 1,
    apiKeyId: 1,
    routeId,
    requestId: globalThis.crypto.randomUUID(),
    amount
  })
}

beforeAll(async () => {
  const testDatabase = await createTestDatabase()
  client = testDatabase.client
  testContext.database = testDatabase.database
})

beforeEach(async () => {
  testContext.leaseClient = null
  testContext.leaseError = null
  testContext.required = false
  await client.exec(`
    TRUNCATE credit_transactions, api_credit_reservations, api_calls, api_keys, users RESTART IDENTITY CASCADE;
    INSERT INTO users (username, email, password_hash, credits, is_active, is_banned) VALUES ('credit-user', 'credit@example.com', 'hash', 10, true, false);
    INSERT INTO api_keys (user_id, name, key_digest, key_ciphertext, key_preview, total_quota) VALUES (1, 'test', 'digest', 'ciphertext', 'preview', 10);
    INSERT INTO api_calls (id, route_id, path, method, status_code) VALUES
      (42, '00000000-0000-4000-8000-000000000001', '/test', 'GET', 200),
      (43, '00000000-0000-4000-8000-000000000001', '/test', 'GET', 200);
  `)
})

afterAll(async () => client.close())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('credit service reservations', () => {
  it('atomically prevents concurrent balance overspend', async () => {
    const results = await Promise.all([reserve(6), reserve(6)])

    expect(results.filter(result => result.status === 'reserved')).toHaveLength(1)
    const key = await client.query<{ used_credits: number }>('SELECT used_credits FROM api_keys WHERE id = 1')
    expect(key.rows[0]?.used_credits).toBe(6)
  })

  it('rolls back the whole reservation when API key quota is exceeded', async () => {
    await client.query('UPDATE api_keys SET total_quota = 5 WHERE id = 1')

    await expect(reserve(6)).resolves.toEqual({ status: 'api_key_quota_exceeded' })
    const reservations = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM api_credit_reservations')
    const key = await client.query<{ used_credits: number }>('SELECT used_credits FROM api_keys WHERE id = 1')
    expect(reservations.rows[0]?.count).toBe(0)
    expect(key.rows[0]?.used_credits).toBe(0)
  })

  it('rejects reservations for inactive or currently banned users', async () => {
    await client.query('UPDATE users SET is_active = false WHERE id = 1')
    await expect(reserve(1)).resolves.toEqual({ status: 'account_unavailable' })

    await client.query('UPDATE users SET is_active = true, is_banned = true, banned_until = now() + interval \'1 hour\' WHERE id = 1')
    await expect(reserve(1)).resolves.toEqual({ status: 'account_unavailable' })
  })

  it('releases user availability and API key quota together', async () => {
    const result = await reserve(8)
    expect(result.status).toBe('reserved')
    if (result.status !== 'reserved') return
    await expect(reserve(3)).resolves.toEqual({ status: 'insufficient_credits' })

    await expect(creditService.releaseReservation(result.reservation.id, 1)).resolves.toBe(true)
    await expect(reserve(3)).resolves.toMatchObject({ status: 'reserved' })
    const key = await client.query<{ used_credits: number }>('SELECT used_credits FROM api_keys WHERE id = 1')
    expect(key.rows[0]?.used_credits).toBe(3)
  })

  it('recovers a durable pending settlement without an API call row', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const result = await reserve(3)
    expect(result.status).toBe('reserved')
    if (result.status !== 'reserved') return
    const reservationId = result.reservation.id
    await expect(creditService.markReservationPending(reservationId, 1)).resolves.toBe(true)

    await creditService.recoverReservations()
    await expect(creditService.getBalance(1)).resolves.toBe(10)
    vi.setSystemTime(Date.now() + 60_000)
    await creditService.recoverReservations()
    await creditService.recoverReservations()
    await expect(creditService.getBalance(1)).resolves.toBe(7)
    await expect(creditService.finalizeReservation({ reservationId, apiCallId: 42 })).resolves.toEqual({
      charged: 3,
      balanceAfter: 7
    })

    const transaction = await client.query<{ api_call_id: number, credit_reservation_id: number }>(
      'SELECT api_call_id, credit_reservation_id FROM credit_transactions'
    )
    const call = await client.query<{ credits_cost: number }>('SELECT credits_cost FROM api_calls WHERE id = 42')
    expect(transaction.rows).toEqual([{ api_call_id: 42, credit_reservation_id: reservationId }])
    expect(call.rows[0]?.credits_cost).toBe(3)
  })

  it('releases only stale active reservations and restores their key quota', async () => {
    const active = await reserve(2)
    const pending = await reserve(2)
    expect(active.status).toBe('reserved')
    expect(pending.status).toBe('reserved')
    if (active.status !== 'reserved' || pending.status !== 'reserved') return
    await creditService.markReservationPending(pending.reservation.id, 1)
    await client.query('UPDATE api_credit_reservations SET created_at = now() - interval \'20 minutes\'')

    await creditService.recoverReservations()
    const remaining = await client.query<{ id: number, status: string }>(
      'SELECT id, status FROM api_credit_reservations'
    )
    const key = await client.query<{ used_credits: number }>('SELECT used_credits FROM api_keys WHERE id = 1')
    expect(remaining.rows).toEqual([{ id: pending.reservation.id, status: 'pending' }])
    expect(key.rows[0]?.used_credits).toBe(2)
  })

  it('backs off actual recovery failures, reaches dead letter and keeps its credits reserved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await reserve(2)
    if (result.status !== 'reserved') throw new Error('reservation setup failed')
    await creditService.markReservationPending(result.reservation.id, 1)
    // Simulate a balance that cannot honor its durable settlement.
    await client.query('UPDATE users SET credits = 0 WHERE id = 1')
    vi.setSystemTime(Date.now() + 60_000)

    for (let attempt = 1; attempt <= 5; attempt++) {
      await creditService.recoverReservations()
      const { rows } = await client.query<{ status: string, attempts: number, next_attempt_at: Date }>(
        'SELECT status, attempts, next_attempt_at FROM api_credit_reservations WHERE id = $1',
        [result.reservation.id]
      )
      expect(rows[0]).toMatchObject({ status: attempt === 5 ? 'dead_letter' : 'pending', attempts: attempt })
      const next = new Date(rows[0]!.next_attempt_at).getTime()
      expect(next).toBeGreaterThan(Date.now())
      await creditService.recoverReservations()
      const unchanged = await client.query<{ attempts: number }>('SELECT attempts FROM api_credit_reservations')
      expect(unchanged.rows[0]?.attempts).toBe(attempt)
      vi.setSystemTime(next)
    }
    await client.query('UPDATE users SET credits = 10 WHERE id = 1')
    await creditService.recoverReservations()
    await expect(creditService.getBalance(1)).resolves.toBe(10)
    const key = await client.query<{ used_credits: number }>('SELECT used_credits FROM api_keys WHERE id = 1')
    expect(key.rows[0]?.used_credits).toBe(2)
    expect((await client.query('SELECT * FROM credit_transactions')).rows).toHaveLength(0)
  })

  it('lets an administrator retry a dead-letter settlement', async () => {
    const result = await reserve(2)
    expect(result.status).toBe('reserved')
    if (result.status !== 'reserved') return
    await creditService.markReservationPending(result.reservation.id, 1)
    await client.query('UPDATE api_credit_reservations SET status = $1, attempts = 5 WHERE id = $2', ['dead_letter', result.reservation.id])

    await expect(creditService.retryCreditReservation(result.reservation.id))
      .resolves.toMatchObject({ status: 'pending', attempts: 0, lastError: null })
  })

  it('lets an administrator charge or release a dead-letter settlement', async () => {
    const charge = await reserve(3)
    const release = await reserve(2)
    expect(charge.status).toBe('reserved')
    expect(release.status).toBe('reserved')
    if (charge.status !== 'reserved' || release.status !== 'reserved') return

    for (const reservation of [charge.reservation, release.reservation]) {
      await creditService.markReservationPending(reservation.id, 1)
      await client.query(
        'UPDATE api_credit_reservations SET status = \'dead_letter\' WHERE id = $1',
        [reservation.id]
      )
    }

    await expect(creditService.forceFinalizeCreditReservation(charge.reservation.id, { id: 9, name: 'admin' }))
      .resolves.toEqual({ charged: 3, balanceAfter: 7 })
    await expect(creditService.forceFinalizeCreditReservation(charge.reservation.id, { id: 10, name: 'another-admin' }))
      .resolves.toEqual({ charged: 3, balanceAfter: 7 })
    await expect(creditService.forceReleaseCreditReservation(release.reservation.id))
      .resolves.toBe(true)

    const key = await client.query<{ used_credits: number }>('SELECT used_credits FROM api_keys WHERE id = 1')
    const user = await client.query<{ credits: number }>('SELECT credits FROM users WHERE id = 1')
    expect(key.rows[0]?.used_credits).toBe(3)
    expect(user.rows[0]?.credits).toBe(7)
    const transactions = await client.query('SELECT amount, operator_id, operator_name FROM credit_transactions')
    expect(transactions.rows).toEqual([{ amount: -3, operator_id: 9, operator_name: 'admin' }])
  })


  it('continues recovering other due reservations after one settlement fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = await reserve(8)
    const successful = await reserve(2)
    if (failing.status !== 'reserved' || successful.status !== 'reserved') throw new Error('reservation setup failed')
    for (const result of [failing, successful]) await creditService.markReservationPending(result.reservation.id, 1)
    await client.query('UPDATE users SET credits = 2 WHERE id = 1')
    await client.query('UPDATE api_credit_reservations SET next_attempt_at = $1 WHERE id = $2',
      [new Date(Date.now() - 2_000), failing.reservation.id])
    await client.query('UPDATE api_credit_reservations SET next_attempt_at = $1 WHERE id = $2',
      [new Date(Date.now() - 1_000), successful.reservation.id])

    await creditService.recoverReservations()

    const remaining = await client.query<{ id: number, attempts: number, status: string }>(
      'SELECT id, attempts, status FROM api_credit_reservations')
    expect(remaining.rows).toEqual([{ id: failing.reservation.id, attempts: 1, status: 'pending' }])
    await expect(creditService.getBalance(1)).resolves.toBe(0)
    const ledger = await client.query<{ credit_reservation_id: number, amount: number }>(
      'SELECT credit_reservation_id, amount FROM credit_transactions')
    expect(ledger.rows).toEqual([{ credit_reservation_id: successful.reservation.id, amount: -2 }])
  })

  it.each(['held', 'unavailable'] as const)('does no recovery writes when the required lease is %s', async (condition) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const active = await reserve(2)
    const pending = await reserve(2)
    if (active.status !== 'reserved' || pending.status !== 'reserved') throw new Error('reservation setup failed')
    await creditService.markReservationPending(pending.reservation.id, 1)
    await client.query('UPDATE api_credit_reservations SET created_at = $1, next_attempt_at = $1', [new Date(Date.now() - 20 * 60_000)])
    testContext.required = true
    testContext.leaseClient = { set: vi.fn(async () => null), eval: vi.fn(async () => 1) }
    if (condition === 'unavailable') testContext.leaseError = new Error('offline')
    const before = await client.query('SELECT * FROM api_credit_reservations ORDER BY id')

    await creditService.recoverReservations()

    expect((await client.query('SELECT * FROM api_credit_reservations ORDER BY id')).rows).toEqual(before.rows)
    expect((await client.query('SELECT * FROM credit_transactions')).rows).toHaveLength(0)
    await expect(creditService.getBalance(1)).resolves.toBe(10)
    expect((await client.query<{ used_credits: number }>('SELECT used_credits FROM api_keys')).rows[0]?.used_credits).toBe(4)
  })

  it('prevents overlapping local scans from consuming multiple failure attempts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const pending = await reserve(2)
    if (pending.status !== 'reserved') throw new Error('reservation setup failed')
    await creditService.markReservationPending(pending.reservation.id, 1)
    await client.query('UPDATE users SET credits = 0 WHERE id = 1')
    await client.query('UPDATE api_credit_reservations SET next_attempt_at = $1', [new Date(Date.now() - 1_000)])

    await Promise.all(Array.from({ length: 3 }, () => creditService.recoverReservations()))

    const rows = await client.query<{ attempts: number }>('SELECT attempts FROM api_credit_reservations')
    expect(rows.rows).toEqual([{ attempts: 1 }])
  })

  it('recovers at most one batch per scan and resumes the remainder on the next scan', async () => {
    await client.query('UPDATE users SET credits = 100 WHERE id = 1')
    await client.query('UPDATE api_keys SET total_quota = 100 WHERE id = 1')
    for (let index = 0; index < 21; index++) {
      const result = await reserve(1)
      if (result.status !== 'reserved') throw new Error('reservation setup failed')
      await creditService.markReservationPending(result.reservation.id, 1)
    }
    await client.query('UPDATE api_credit_reservations SET next_attempt_at = $1', [new Date(Date.now() - 1_000)])

    await creditService.recoverReservations()
    expect((await client.query('SELECT * FROM api_credit_reservations')).rows).toHaveLength(1)
    await expect(creditService.getBalance(1)).resolves.toBe(80)
    await creditService.recoverReservations()
    expect((await client.query('SELECT * FROM api_credit_reservations')).rows).toHaveLength(0)
    expect((await client.query('SELECT * FROM credit_transactions')).rows).toHaveLength(21)
    await expect(creditService.getBalance(1)).resolves.toBe(79)
  })

  it('does not allow an administrator to charge or retry an active call', async () => {
    const result = await reserve(3)
    expect(result.status).toBe('reserved')
    if (result.status !== 'reserved') return

    await expect(creditService.forceFinalizeCreditReservation(result.reservation.id, { id: 9, name: 'admin' }))
      .rejects.toMatchObject({ statusCode: 404 })
    await expect(creditService.retryCreditReservation(result.reservation.id)).resolves.toBeNull()
    const user = await client.query<{ credits: number }>('SELECT credits FROM users WHERE id = 1')
    expect(user.rows[0]?.credits).toBe(10)
  })
})
