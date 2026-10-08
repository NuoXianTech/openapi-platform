import { createServer } from 'node:http'
import { createApp, createError, eventHandler, toNodeListener, type H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../../../helpers/database'
import { createGatewayMatch } from '../../../helpers/gateway-match'
import * as schema from '~~/server/db/schema'
import { digestStoredSecret } from '~~/server/utils/stored-secret'

const context = vi.hoisted(() => ({ database: null as unknown, resolve: vi.fn() }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
vi.mock('~~/server/services/routing-runtime-service', async original => ({
  ...await original<typeof import('~~/server/services/routing-runtime-service')>(),
  routingRuntimeService: { resolve: context.resolve }
}))
vi.mock('~~/server/services/upstream-service-token-service', () => ({
  upstreamServiceTokenService: { get: async () => 'test-service-token' }
}))
// Run Nitro's public error handler in the same real H3 request adapter.
vi.mock('nitropack/runtime', () => ({ defineNitroErrorHandler: <T>(handler: T) => handler }))
const { dynamicGatewayService } = await import('~~/server/services/dynamic-gateway-service')
const { gatewayCallService } = await import('~~/server/services/dynamic-gateway-call-service')
const { creditService } = await import('~~/server/services/credit-service')
const rateLimit = await import('~~/server/utils/rate-limit')
const { createRedisUnavailableError } = await import('~~/server/utils/redis')
const { closeSafeFetchTransports } = await import('~~/server/utils/safe-fetch')
const { default: publicErrorHandler } = await import('~~/server/error')

let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>
let match = createGatewayMatch()
let lastEvent: H3Event
let fallbackWithMatch: boolean | null = null
let upstreamRequests = 0
const apiKey = 'test-gateway-caller-key'
const upstream = createServer((_req, res) => { upstreamRequests += 1; res.end('result') })
const app = createApp()
app.use(eventHandler(async event => {
  lastEvent = event
  if (fallbackWithMatch !== null) {
    if (fallbackWithMatch) gatewayCallService.start(event, match)
    return publicErrorHandler(createError({ statusCode: 500 }), event)
  }
  return (await dynamicGatewayService.tryHandle(event)).response
}))
const gateway = createServer(toNodeListener(app))
let url: string

beforeAll(async () => {
  testDatabase = await createTestDatabase()
  context.database = testDatabase.database
  await Promise.all([upstream, gateway].map(server => new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))))
  url = `http://127.0.0.1:${(gateway.address() as { port: number }).port}/v1/stream`
})

beforeEach(async () => {
  vi.stubGlobal('useRuntimeConfig', () => ({ apiKeySecret: '0123456789abcdef0123456789abcdef', redis: { url: '' } }))
  match = createGatewayMatch()
  match.upstream.targets[0]!.baseUrl = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  context.resolve.mockResolvedValue({ match, allowedMethods: ['GET'] })
  fallbackWithMatch = null
  upstreamRequests = 0
  await testDatabase.client.exec('TRUNCATE credit_transactions, api_credit_reservations, api_call_stats, api_calls, api_keys, users RESTART IDENTITY CASCADE')
  await testDatabase.database.insert(schema.users).values({
    id: 1, username: 'caller', email: 'caller@example.test', passwordHash: 'test', credits: 10, isActive: true
  })
  await testDatabase.database.insert(schema.apiKeys).values({
    id: 1, userId: 1, name: 'Caller key', keyDigest: digestStoredSecret(apiKey, 'api-key'),
    keyCiphertext: 'unused', keyPreview: 'test', totalQuota: 10
  })
})

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
afterAll(async () => {
  await closeSafeFetchTransports()
  await Promise.all([upstream, gateway].map(server => new Promise<void>(resolve => {
    server.closeAllConnections()
    server.close(() => resolve())
  })))
  await testDatabase.client.close()
})

async function complete() {
  await Promise.all([gatewayCallService.complete(lastEvent), gatewayCallService.complete(lastEvent)])
  await gatewayCallService.complete(lastEvent)
}

describe('Gateway call outcomes through HTTP and persisted records', () => {
  it.each([
    ['missing', 401, 'MISSING_API_KEY', false],
    ['invalid', 401, 'INVALID_API_KEY', false],
    ['disabled', 401, 'DISABLED_API_KEY', true],
    ['expired', 401, 'EXPIRED_API_KEY', true],
    ['scope', 403, 'SCOPE_DENIED', true],
    ['ip', 403, 'IP_DENIED', true],
    ['quota', 429, 'API_KEY_QUOTA_EXCEEDED', true],
    ['credits', 402, 'INSUFFICIENT_CREDITS', true],
    ['billing unavailable', 503, 'CREDITS_UNAVAILABLE', true],
    ['limiter unavailable', 503, 'RATE_LIMIT_UNAVAILABLE', true],
    ['account disabled during admission', 401, 'DISABLED_API_KEY', true]
  ] as const)('preserves %s rejection details without counting or charging the request', async (kind, status, code, logged) => {
    const db = testDatabase.database
    if (kind === 'disabled') await db.update(schema.apiKeys).set({ isActive: false }).where(eq(schema.apiKeys.id, 1))
    if (kind === 'expired') await db.update(schema.apiKeys).set({ expiresAt: new Date('2020-01-01') }).where(eq(schema.apiKeys.id, 1))
    if (kind === 'scope') await db.update(schema.apiKeys).set({ scopes: ['route:not-this-route'] }).where(eq(schema.apiKeys.id, 1))
    if (kind === 'ip') await db.update(schema.apiKeys).set({ ipWhitelist: ['192.0.2.0/24'] }).where(eq(schema.apiKeys.id, 1))
    if (kind === 'quota') await db.update(schema.apiKeys).set({ totalQuota: 1 }).where(eq(schema.apiKeys.id, 1))
    if (kind === 'credits') await db.update(schema.users).set({ credits: 1 }).where(eq(schema.users.id, 1))
    if (kind === 'billing unavailable') {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      vi.spyOn(creditService, 'reserve').mockRejectedValueOnce(new Error('billing offline'))
    }
    if (kind === 'limiter unavailable') {
      vi.spyOn(rateLimit, 'consumeRateLimitWindows').mockRejectedValueOnce(createRedisUnavailableError('limiter offline'))
    }
    if (kind === 'account disabled during admission') {
      const reserve = creditService.reserve
      vi.spyOn(creditService, 'reserve').mockImplementationOnce(async input => {
        await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, 1))
        return reserve(input)
      })
    }
    const response = await fetch(url, { headers: kind === 'missing' ? {} : { 'x-api-key': kind === 'invalid' ? 'invalid-key' : apiKey } })
    const body = await response.json() as { code: string, message: string }
    expect(response.status).toBe(status)
    expect(body.code).toBe(code)
    // A later generic failure must not erase the admission reason or its classification.
    gatewayCallService.fail(lastEvent, 'LATER_FAILURE', 'later failure')
    await complete()
    const calls = await db.select().from(schema.apiCalls)
    expect(calls).toHaveLength(logged ? 1 : 0)
    if (logged) expect(calls[0]).toMatchObject({
      errorCode: code, errorMessage: body.message, statusCode: status, isCounted: false,
      userId: 1, apiKeyId: 1, apiKeyName: 'Caller key', creditsCost: 0, upstreamTargetId: null
    })
    expect(await db.select().from(schema.apiCallStats)).toEqual([])
    expect(await db.select().from(schema.apiCreditReservations)).toEqual([])
    expect(await db.select().from(schema.creditTransactions)).toEqual([])
    expect((await db.select().from(schema.apiKeys))[0]).toMatchObject({ totalCalls: 0, usedCredits: 0 })
    expect(upstreamRequests).toBe(0)
  })

  it('keeps anonymous rate rejections out of counted calls after an earlier success', async () => {
    Object.assign(match.route, { isApiKey: false, creditsCost: 0, rateLimitPerMinute: 1 })
    expect(await (await fetch(url)).text()).toBe('result')
    await complete()
    const limited = await fetch(url)
    expect(limited.status).toBe(429)
    expect(await limited.json()).toMatchObject({ code: 'RATE_LIMITED' })
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    await complete()
    const calls = await testDatabase.database.select().from(schema.apiCalls).orderBy(schema.apiCalls.id)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ errorCode: 'RATE_LIMITED', isCounted: false, userId: null, apiKeyId: null })
    expect((await testDatabase.database.select().from(schema.apiCallStats))[0]).toMatchObject({ totalCount: 1, successCount: 1, failureCount: 0 })
    expect(upstreamRequests).toBe(1)
  })

  it('keeps successful paid completion stable after late failure and admission observations', async () => {
    expect(await (await fetch(url, { headers: { 'x-api-key': apiKey } })).text()).toBe('result')
    await complete()
    const calls = await testDatabase.database.select().from(schema.apiCalls)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ errorCode: null, isCounted: true, statusCode: 200, creditsCost: 2, userId: 1 })
    gatewayCallService.fail(lastEvent, 'LATE_FAILURE', 'ignored')
    gatewayCallService.rejectAccess(lastEvent, null, { outcome: 'scope_denied', errorCode: 'SCOPE_DENIED', errorMessage: 'ignored' })
    await complete()
    expect(await testDatabase.database.select().from(schema.apiCalls)).toEqual(calls)
    expect((await testDatabase.database.select().from(schema.apiKeys))[0]).toMatchObject({ totalCalls: 1, usedCredits: 2 })
    expect((await testDatabase.database.select().from(schema.users))[0]?.credits).toBe(8)
    expect(await testDatabase.database.select().from(schema.creditTransactions)).toHaveLength(1)
  })

  it('preserves disabled statistics for a known caller rejection', async () => {
    match.route.isStatistics = false
    await testDatabase.database.update(schema.apiKeys).set({ scopes: ['route:another'] }).where(eq(schema.apiKeys.id, 1))
    const response = await fetch(url, { headers: { 'x-api-key': apiKey } })
    expect(response.status).toBe(403)
    await response.arrayBuffer()
    await complete()
    expect(await testDatabase.database.select().from(schema.apiCalls)).toEqual([])
    expect(await testDatabase.database.select().from(schema.apiCallStats)).toEqual([])
    expect((await testDatabase.database.select().from(schema.apiKeys))[0]?.totalCalls).toBe(0)
  })

  it.each([false, true])('records a Nitro fallback only when a call has started (matched=%s)', async matched => {
    fallbackWithMatch = matched
    const response = await fetch(url)
    expect(response.status).toBe(500)
    const body = await response.json() as { code: string, message: string }
    expect(body.code).toBe('INTERNAL_ERROR')
    await complete()
    const calls = await testDatabase.database.select().from(schema.apiCalls)
    expect(calls).toHaveLength(matched ? 1 : 0)
    if (matched) expect(calls[0]).toMatchObject({ errorCode: body.code, errorMessage: body.message, statusCode: 500, isCounted: true })
    expect(upstreamRequests).toBe(0)
  })
})
