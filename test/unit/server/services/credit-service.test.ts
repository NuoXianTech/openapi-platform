import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'

const testContext = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
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
  client = new PGlite()
  await client.exec(`
    CREATE TABLE users (
      id serial PRIMARY KEY,
      credits integer NOT NULL DEFAULT 0,
      is_active boolean NOT NULL DEFAULT true,
      is_banned boolean NOT NULL DEFAULT false,
      banned_until timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE api_keys (
      id serial PRIMARY KEY,
      user_id integer NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      total_quota integer,
      used_credits integer NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE api_calls (
      id bigserial PRIMARY KEY,
      credits_cost integer NOT NULL DEFAULT 0
    );
    CREATE TABLE api_credit_reservations (
      id bigserial PRIMARY KEY,
      user_id integer NOT NULL,
      api_key_id integer NOT NULL,
      route_id uuid NOT NULL,
      api_call_id bigint,
      request_id uuid NOT NULL,
      amount integer NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'active',
      attempts integer NOT NULL DEFAULT 0,
      last_error varchar(500),
      last_attempt_at timestamptz,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE credit_transactions (
      id bigserial PRIMARY KEY,
      user_id integer,
      amount integer NOT NULL,
      balance_after integer NOT NULL,
      reason varchar(50) NOT NULL,
      route_id uuid,
      api_call_id bigint,
      credit_reservation_id bigint,
      code_id integer,
      operator_id integer,
      operator_name varchar(140),
      ip varchar(45),
      remark varchar(500),
      meta jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX credit_transactions_api_call_reason_uq
      ON credit_transactions (api_call_id, reason)
      WHERE api_call_id IS NOT NULL;
    CREATE UNIQUE INDEX credit_transactions_reservation_uq
      ON credit_transactions (credit_reservation_id)
      WHERE credit_reservation_id IS NOT NULL;
  `)
  testContext.database = drizzle(client, { schema })
})

beforeEach(async () => {
  await client.exec(`
    TRUNCATE credit_transactions, api_credit_reservations, api_calls, api_keys, users RESTART IDENTITY;
    INSERT INTO users (credits, is_active, is_banned) VALUES (10, true, false);
    INSERT INTO api_keys (user_id, total_quota) VALUES (1, 10);
    INSERT INTO api_calls (id) VALUES (42), (43);
  `)
})

afterAll(async () => client.close())

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
    const result = await reserve(3)
    expect(result.status).toBe('reserved')
    if (result.status !== 'reserved') return
    const reservationId = result.reservation.id
    await expect(creditService.markReservationPending(reservationId, 1)).resolves.toBe(true)

    await expect(creditService.finalizeReservation({ reservationId })).resolves.toEqual({
      charged: 3,
      balanceAfter: 7
    })
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

    await expect(
      creditService.releaseExpiredReservations(new Date(Date.now() - 10 * 60_000))
    ).resolves.toBe(1)
    const remaining = await client.query<{ id: number, status: string }>(
      'SELECT id, status FROM api_credit_reservations'
    )
    const key = await client.query<{ used_credits: number }>('SELECT used_credits FROM api_keys WHERE id = 1')
    expect(remaining.rows).toEqual([{ id: pending.reservation.id, status: 'pending' }])
    expect(key.rows[0]?.used_credits).toBe(2)
  })

  it('moves repeatedly failing settlements to dead letter', async () => {
    const result = await reserve(2)
    expect(result.status).toBe('reserved')
    if (result.status !== 'reserved') return
    await creditService.markReservationPending(result.reservation.id, 1)

    for (let attempt = 0; attempt < 5; attempt++) {
      await creditService.markReservationAttempt(result.reservation.id, 'database unavailable')
    }
    const row = await client.query<{ status: string, attempts: number }>(
      'SELECT status, attempts FROM api_credit_reservations WHERE id = $1',
      [result.reservation.id]
    )
    expect(row.rows).toEqual([{ status: 'dead_letter', attempts: 5 }])
  })

  it('lets an administrator retry a dead-letter settlement', async () => {
    const result = await reserve(2)
    expect(result.status).toBe('reserved')
    if (result.status !== 'reserved') return
    await creditService.markReservationPending(result.reservation.id, 1)
    for (let attempt = 0; attempt < 5; attempt++) {
      await creditService.markReservationAttempt(result.reservation.id, 'database unavailable')
    }

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
