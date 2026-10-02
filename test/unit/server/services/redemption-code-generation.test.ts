import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createTestDatabase } from '../../../helpers/database'
import { redemptionCodes } from '~~/server/db/schema'

const context = vi.hoisted(() => ({ database: null as unknown, digits: null as number[] | null, audit: vi.fn(), decode: vi.fn() }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
vi.mock('node:crypto', async original => {
  const crypto = await original<typeof import('node:crypto')>()
  return { ...crypto, randomInt: (max: number) => context.digits ? context.digits.shift() ?? 0 : crypto.randomInt(max) }
})
vi.mock('~~/server/utils/stored-secret', async original => {
  const secrets = await original<typeof import('~~/server/utils/stored-secret')>()
  return { ...secrets, decryptStoredSecret: (...args: Parameters<typeof secrets.decryptStoredSecret>) => {
    context.decode()
    return secrets.decryptStoredSecret(...args)
  } }
})
vi.mock('~~/server/utils/auth', () => ({ defineAdminEventHandler: (handler: unknown) => handler }))
vi.mock('~~/server/utils/request-operation-log', () => ({ addRequestOperationLog: context.audit }))
vi.mock('~~/server/utils/zod', () => ({
  readZodBody: async (event: { body: unknown }, schema: { parse: (value: unknown) => unknown }) => schema.parse(event.body)
}))
const { default: generateHandler } = await import('~~/server/api/admin/redemption-codes/generate.post')
const { redemptionService } = await import('~~/server/services/redemption-service')
let fixture: Awaited<ReturnType<typeof createTestDatabase>>
const future = '2099-01-01T00:00:00.000Z'
const invoke = (body: object) => (generateHandler as unknown as (event: unknown, admin: unknown) => ReturnType<typeof redemptionService.generate>)(
  { body: { amount: 10, ...body } }, { id: 1, username: 'admin' }
)
const stored = () => fixture.database.select().from(redemptionCodes)

beforeAll(async () => {
  fixture = await createTestDatabase()
  context.database = fixture.database
  vi.stubGlobal('useRuntimeConfig', () => ({ apiKeySecret: '0123456789abcdef0123456789abcdef' }))
})
beforeEach(async () => {
  context.digits = null
  context.audit.mockReset()
  context.decode.mockReset()
  await fixture.client.exec('TRUNCATE redemption_codes RESTART IDENTITY CASCADE')
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
afterAll(async () => { await fixture.client.close(); vi.unstubAllGlobals() })

describe('complete redemption issuance through its public interface', () => {
  it.each(['2000-01-01T00:00:00.000Z', 'not-a-date', ''])('rejects expiry %j through the HTTP handler without issuing permanent codes', async (expiresAt) => {
    await expect(invoke({ expiresAt })).rejects.toMatchObject({ statusCode: 400, data: { code: 'REDEMPTION_EXPIRY_INVALID' } })
    expect(await stored()).toEqual([])
    expect(context.audit).not.toHaveBeenCalled()
  })

  it.each([new Date('invalid'), new Date('2000-01-01T00:00:00Z'), 'invalid'])('enforces expiry for direct module callers: %s', async (expiresAt) => {
    await expect(redemptionService.generate({ amount: 10, expiresAt })).rejects.toMatchObject({ statusCode: 400 })
    expect(await stored()).toEqual([])
  })

  it.each([null, undefined])('creates permanent codes only when expiry is explicitly absent: %s', async (expiresAt) => {
    const result = await invoke({ count: 2, expiresAt })
    expect(result).toMatchObject({ generated: 2, requested: 2, expiresAt: null })
    expect(await stored()).toHaveLength(2)
    expect((await stored()).every(row => row.expiresAt === null)).toBe(true)
    expect(context.audit).toHaveBeenCalledOnce()
  })

  it('preserves a future expiry, complete metadata, and the fixed encrypted code format', async () => {
    const result = await invoke({ count: 3, amount: 20, maxUses: 2, expiresAt: future, note: '  campaign  ' })
    const rows = await stored()
    expect(result).toMatchObject({ generated: 3, requested: 3, amount: 20, maxUses: 2, expiresAt: new Date(future), note: 'campaign' })
    expect(result.codes).toHaveLength(3)
    expect(new Set(result.codes.map(row => row.code)).size).toBe(3)
    for (const code of result.codes) {
      const row = rows.find(row => row.id === code.id)!
      expect(code.code).toMatch(/^[a-z0-9]{32}$/)
      expect(row).toMatchObject({ batchId: result.batchId, amount: 20, maxUses: 2, createdBy: 1, note: 'campaign', isEnabled: true, usedCount: 0, expiresAt: new Date(future) })
      expect(row.codeCiphertext).not.toBe(code.code)
      await expect(redemptionService.reveal(code.id)).resolves.toEqual({ id: code.id, code: code.code })
    }
    expect(context.audit).toHaveBeenCalledOnce()
  })

  it('keeps existing normalization at the complete generation interface', async () => {
    const result = await redemptionService.generate({ amount: -5, count: 5000, maxUses: 0, note: 'x'.repeat(600) })
    expect(result).toMatchObject({ amount: 1, generated: 100, requested: 100, maxUses: 1, note: 'x'.repeat(500) })
  })

  async function seedCollision() {
    context.digits = []
    const seed = await redemptionService.generate({ amount: 10 })
    // cccc batch suffix, then an existing a-code and a new b-code.
    context.digits = [...Array<number>(4).fill(2), ...Array<number>(32).fill(0), ...Array<number>(32).fill(1)]
    return seed
  }

  it('fills missing codes after an actual database uniqueness conflict', async () => {
    await seedCollision()
    context.digits!.push(...Array<number>(32).fill(3))
    const result = await invoke({ count: 2 })
    expect(result.codes.map(row => row.code)).toEqual(['b'.repeat(32), 'd'.repeat(32)])
    expect(result).toMatchObject({ generated: 2, requested: 2 })
    expect(await stored()).toHaveLength(3)
    expect(context.audit).toHaveBeenCalledOnce()
  })

  it('rolls back a partially filled batch when retries exhaust, retaining only pre-existing codes', async () => {
    const seed = await seedCollision()
    await expect(invoke({ count: 2 })).rejects.toThrow('Redemption code generation conflicts too often')
    expect((await stored()).map(row => row.id)).toEqual([seed.codes[0]!.id])
    expect(context.audit).not.toHaveBeenCalled()
  })

  it('bounds repeated collisions within one batch instead of looping forever', async () => {
    context.digits = []
    await expect(invoke({ count: 2 })).rejects.toThrow('Redemption code generation conflicts too often')
    expect(await stored()).toEqual([])
  })

  it('rolls back all inserted codes when building the plaintext result fails', async () => {
    context.decode.mockImplementationOnce(() => { throw new Error('fixture decoding failure') })
    await expect(invoke({ count: 2 })).rejects.toThrow('fixture decoding failure')
    expect(await stored()).toEqual([])
    expect(context.audit).not.toHaveBeenCalled()
  })

  it('rolls back if expiry is reached while constructing the batch result', async () => {
    const expiresAt = new Date(Date.now() + 60_000)
    context.decode.mockImplementationOnce(() => { vi.spyOn(Date, 'now').mockReturnValue(expiresAt.getTime()) })
    await expect(invoke({ expiresAt: expiresAt.toISOString() })).rejects.toMatchObject({ statusCode: 400 })
    expect(await stored()).toEqual([])
    expect(context.audit).not.toHaveBeenCalled()
  })

  it('rejects expiry exactly at the current instant', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date(future).getTime())
    await expect(invoke({ expiresAt: future })).rejects.toMatchObject({ statusCode: 400 })
    expect(await stored()).toEqual([])
  })
})
