import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'

const context = vi.hoisted(() => ({ database: null as unknown }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
const { listAdminCreditTransactions } = await import('~~/server/services/admin-credit-transaction-service')
const { creditService } = await import('~~/server/services/credit-service')
let client: PGlite

beforeAll(async () => {
  client = new PGlite()
  await client.exec(`
    CREATE TABLE users (
      id serial PRIMARY KEY, username text, role text NOT NULL DEFAULT 'user',
      credits integer NOT NULL DEFAULT 100, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE api_keys (
      id serial PRIMARY KEY, name text, used_credits integer NOT NULL DEFAULT 20,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE api_routes (id uuid PRIMARY KEY, name text, path_pattern text);
    CREATE TABLE api_calls (id bigserial PRIMARY KEY, credits_cost integer NOT NULL DEFAULT 0);
    CREATE TABLE credit_transactions (
      id bigserial PRIMARY KEY, user_id integer, amount integer NOT NULL,
      balance_after integer NOT NULL, reason varchar(50) NOT NULL, route_id uuid,
      api_call_id bigint, credit_reservation_id bigint UNIQUE, code_id integer,
      operator_id integer, operator_name varchar(140), ip varchar(45), remark varchar(500),
      meta jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE api_credit_reservations (
      id bigserial PRIMARY KEY, user_id integer NOT NULL, api_key_id integer NOT NULL,
      route_id uuid NOT NULL, api_call_id bigint, request_id uuid NOT NULL,
      amount integer NOT NULL, status varchar(20) NOT NULL DEFAULT 'active',
      attempts integer NOT NULL DEFAULT 0, last_error varchar(500), last_attempt_at timestamptz,
      next_attempt_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  context.database = drizzle(client, { schema })
})

beforeEach(async () => {
  await client.exec(`
    TRUNCATE credit_transactions, api_credit_reservations, api_calls, api_keys, api_routes, users RESTART IDENTITY;
    INSERT INTO users (username, role) VALUES ('alice', 'user'), ('bob', 'admin');
    INSERT INTO api_keys (name) VALUES ('key-a'), ('key-b');
    INSERT INTO api_routes VALUES ('00000000-0000-4000-8000-000000000001', 'Test API', '/v1/test');
    INSERT INTO api_calls (id) VALUES (42);
    INSERT INTO credit_transactions (user_id, amount, balance_after, reason, operator_id, operator_name, created_at)
      VALUES (1, 20, 20, 'admin_grant', 9, 'Admin', '2026-09-08T08:00:00Z');
    INSERT INTO credit_transactions (user_id, amount, balance_after, reason, credit_reservation_id, created_at)
      VALUES (1, -3, 17, 'api_charge', 90, '2026-09-08T09:00:00Z'),
             (2, -2, 8, 'api_charge', NULL, '2026-09-08T09:30:00Z'),
             (99, 1, 1, 'signup_bonus', NULL, '2026-09-08T07:00:00Z');
    INSERT INTO api_credit_reservations (user_id, api_key_id, route_id, request_id, amount, status, attempts, last_error, last_attempt_at, next_attempt_at, created_at)
      SELECT data.user_id, data.user_id, '00000000-0000-4000-8000-000000000001'::uuid,
        ('00000000-0000-4000-9000-' || lpad(data.amount::text, 12, '0'))::uuid,
        data.amount, data.status, data.attempts, data.error, '2026-09-08T11:30:00Z'::timestamptz,
        '2026-09-08T12:00:00Z'::timestamptz, data.created::timestamptz
      FROM (VALUES
        (1, 4, 'active', 0, NULL, '2026-09-08T10:00:00Z'),
        (1, 5, 'pending', 0, NULL, '2026-09-08T11:00:00Z'),
        (1, 6, 'pending', 1, 'database unavailable', '2026-09-08T11:10:00Z'),
        (2, 7, 'dead_letter', 5, 'balance unavailable', '2026-09-08T11:20:00Z')
      ) AS data(user_id, amount, status, attempts, error, created);
    INSERT INTO api_credit_reservations (id, user_id, api_key_id, route_id, request_id, amount, status)
      VALUES (90, 1, 1, '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-9000-000000000090', 3, 'dead_letter');
  `)
})

afterAll(async () => client.close())

describe('unified admin credit transactions', () => {
  it('sorts and paginates posted and reserved records together without ID collisions', async () => {
    const first = await listAdminCreditTransactions({ limit: 3 })
    const second = await listAdminCreditTransactions({ limit: 3, offset: 3 })

    expect(first.total).toBe(8)
    expect(second.total).toBe(8)
    expect(first.items.map(row => row.key)).toEqual(['reservation:4', 'reservation:3', 'reservation:2'])
    expect(second.items.map(row => row.key)).toEqual(['reservation:1', 'transaction:3', 'transaction:2'])
    expect(first.items[0]).toMatchObject({
      kind: 'reservation', status: 'dead_letter', amount: -7, balanceAfter: null,
      userName: 'bob', userRole: 'admin', routeName: 'Test API', routePath: '/v1/test',
      creditReservationId: 4, createdAt: '2026-09-08T11:20:00.000Z',
      reservation: { apiKeyName: 'key-b', attempts: 5, lastError: 'balance unavailable', nextAttemptAt: '2026-09-08T12:00:00.000Z' }
    })
  })

  it('includes failed retries and dead letters in exceptions, excluding normal pending and active calls', async () => {
    const result = await listAdminCreditTransactions({ status: 'exceptions' })
    expect(result.total).toBe(2)
    expect(result.items.map(row => row.key)).toEqual(['reservation:4', 'reservation:3'])
  })

  it.each([
    ['posted', ['transaction:3', 'transaction:2', 'transaction:1', 'transaction:4']],
    ['pending', ['reservation:3', 'reservation:2']],
    ['dead_letter', ['reservation:4']],
    ['active', ['reservation:1']]
  ] as const)('filters %s records with a matching total', async (status, keys) => {
    const result = await listAdminCreditTransactions({ status })
    expect(result.items.map(row => row.key)).toEqual(keys)
    expect(result.total).toBe(keys.length)
    if (status === 'posted') expect(result.items[0]).toMatchObject({ balanceAfter: 8, reservation: null })
  })

  it('applies user, reason, direction, date and signed amount filters to both sources', async () => {
    const result = await listAdminCreditTransactions({
      userId: 1, reason: 'api_charge', direction: 'out', minAmount: -6, maxAmount: -3,
      startAt: new Date('2026-09-08T09:00:00Z'), endAt: new Date('2026-09-08T11:10:00Z')
    })
    expect(result.total).toBe(4)
    expect(result.items.map(row => row.key)).toEqual(['reservation:3', 'reservation:2', 'reservation:1', 'transaction:2'])
  })

  it('does not count a reserved debit as income or as an administrator adjustment', async () => {
    const income = await listAdminCreditTransactions({ direction: 'in' })
    const operated = await listAdminCreditTransactions({ operatorName: 'adm' })
    const grants = await listAdminCreditTransactions({ reason: 'admin_grant' })
    expect(income.items.map(row => row.key)).toEqual(['transaction:1', 'transaction:4'])
    expect(operated.items.map(row => row.key)).toEqual(['transaction:1'])
    expect(grants.items.map(row => row.key)).toEqual(['transaction:1'])
  })

  it('retains audit records when their user, API key or route no longer exists', async () => {
    await client.exec('DELETE FROM api_routes; DELETE FROM api_keys;')
    const reservations = await listAdminCreditTransactions({ status: 'exceptions' })
    const deletedUser = await listAdminCreditTransactions({ userId: 99 })
    expect(reservations.total).toBe(2)
    expect(reservations.items[0]).toMatchObject({ routeName: null, routePath: null, reservation: { apiKeyName: null } })
    expect(deletedUser.items[0]).toMatchObject({ key: 'transaction:4', userId: 99, userName: null, userRole: null })
  })

  it('replaces a resolved exception with exactly one posted charge and its operator', async () => {
    await creditService.forceFinalizeCreditReservation(3, { id: 9, name: 'Admin' })
    await creditService.forceFinalizeCreditReservation(3, { id: 9, name: 'Admin' })
    const all = await listAdminCreditTransactions()
    const exceptions = await listAdminCreditTransactions({ status: 'exceptions' })
    const records = all.items.filter(row => row.creditReservationId === 3)

    expect(all.total).toBe(8)
    expect(exceptions.total).toBe(1)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'transaction', status: 'posted', amount: -6, balanceAfter: 94, operatorId: 9, operatorName: 'Admin', reservation: null })
  })

  it('returns an accurate empty page and a stable order for equal timestamps', async () => {
    await client.exec("UPDATE api_credit_reservations SET created_at = '2026-09-08T09:30:00Z' WHERE id = 3")
    const result = await listAdminCreditTransactions({ startAt: new Date('2026-09-08T09:30:00Z'), endAt: new Date('2026-09-08T09:30:00Z') })
    expect(result.items.map(row => row.key)).toEqual(['reservation:3', 'transaction:3'])
    expect(await listAdminCreditTransactions({ status: 'exceptions', userId: 99 })).toEqual({ items: [], total: 0 })
    expect(await listAdminCreditTransactions({ offset: 100 })).toEqual({ items: [], total: 8 })
  })
})
