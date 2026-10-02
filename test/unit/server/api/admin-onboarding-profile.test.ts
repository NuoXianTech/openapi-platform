import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { SITE_SETTINGS_DEFAULTS } from '#shared/config/site-defaults'
import { createTestDatabase } from '../../../helpers/database'
const context = vi.hoisted(() => ({ database: null as unknown, cookie: vi.fn(), audit: vi.fn() }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
vi.mock('h3', async (original) => ({ ...await original<typeof import('h3')>(), setCookie: context.cookie }))
vi.mock('~~/server/utils/auth', async original => ({
  ...await original<typeof import('~~/server/utils/auth')>(), defineAdminEventHandler: (handler: unknown) => handler
}))
vi.mock('~~/server/utils/request-operation-log', () => ({ addRequestOperationLog: context.audit }))
vi.mock('~~/server/services/system-settings-service', () => ({
  systemSettingsService: { getSettings: async () => SITE_SETTINGS_DEFAULTS }
}))
vi.mock('~~/server/utils/zod', () => ({
  readZodBody: async (event: { body: unknown }, schema: { parse: (value: unknown) => unknown }) => schema.parse(event.body)
}))
vi.stubGlobal('useRuntimeConfig', () => ({ auth: { secret: 'review-onboarding-fixture-secret-more-than-32-bytes' } }))
const { default: profile } = await import('~~/server/api/admin/onboarding/profile.put')
const { adminUserService } = await import('~~/server/services/admin-user-service')
const { userCredentialsService } = await import('~~/server/services/user-credentials-service')
const { userService } = await import('~~/server/services/user-service')
const { hashPassword } = await import('~~/server/utils/password')
const { verifyAccessToken } = await import('~~/server/utils/jwt')
let fixture: Awaited<ReturnType<typeof createTestDatabase>>
let admin: Awaited<ReturnType<typeof userService.addUser>>
beforeAll(async () => { fixture = await createTestDatabase(); context.database = fixture.database })
beforeEach(async () => {
  vi.clearAllMocks()
  await fixture.client.exec('TRUNCATE users RESTART IDENTITY CASCADE')
  admin = await userService.addUser({
    role: 'admin', username: 'admin', email: 'admin@openapi.com',
    passwordHash: await hashPassword('FactoryFixture!42'), isActive: true
  })
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => { await fixture.client.close(); vi.unstubAllGlobals() })
const invoke = (body: object = {}) => (profile as unknown as (event: unknown, admin: unknown) => Promise<Record<string, unknown>>)(
  { body: { password: 'FirstRotation!42', ...body } }, admin
)

it('rejects a replacement session which would borrow a later credential version and retains the audit', async () => {
  const complete = userCredentialsService.completeAdminProfile.bind(userCredentialsService)
  let committedVersion: number | undefined
  vi.spyOn(userCredentialsService, 'completeAdminProfile').mockImplementationOnce(async (input) => {
    const first = await complete(input)
    committedVersion = first.updated.tokenVersion
    await adminUserService.updateUser(input.userId, { passwordHash: await hashPassword('LaterRotation!42') })
    return first
  })
  await expect(invoke()).rejects.toMatchObject({ statusCode: 401 })
  expect(committedVersion).toBe(1)
  expect(context.cookie).not.toHaveBeenCalled()
  expect(context.audit).toHaveBeenCalledOnce()
  expect((await userService.getById(admin.id))?.tokenVersion).toBe(2)
})
it('audits a committed password change even when the session stage can no longer find the user', async () => {
  const read = userService.getById.bind(userService)
  let reads = 0
  vi.spyOn(userService, 'getById').mockImplementation(async id => ++reads === 2 ? null : read(id))
  await expect(invoke()).rejects.toMatchObject({ statusCode: 401 })
  expect((await read(admin.id))?.tokenVersion).toBe(1)
  expect(context.audit).toHaveBeenCalledOnce()
  expect(context.cookie).not.toHaveBeenCalled()
})

it('returns a safe profile and signs the exact committed version after recording the renamed actor', async () => {
  const result = await invoke({ username: 'owner', email: 'owner@example.com' })
  expect(result).toMatchObject({ id: admin.id, username: 'owner', email: 'owner@example.com' })
  expect(result).not.toHaveProperty('passwordHash')
  expect(result).not.toHaveProperty('tokenVersion')
  expect(verifyAccessToken(context.cookie.mock.calls[0]![2])).toMatchObject({ sub: admin.id, ver: 1, role: 'admin' })
  expect(context.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    actor: 'owner', detail: {
      previous: { username: 'admin', email: 'admin@openapi.com' },
      patch: { usernameChanged: true, emailChanged: true, passwordChanged: true }
    }
  }))
  expect(context.audit.mock.invocationCallOrder[0]).toBeLessThan(context.cookie.mock.invocationCallOrder[0]!)
})
