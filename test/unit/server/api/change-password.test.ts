import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ change: vi.fn(), session: vi.fn(), audit: vi.fn() }))
vi.mock('~~/server/services/user-credentials-service', () => ({ userCredentialsService: { changePassword: mocks.change } }))
vi.mock('~~/server/utils/auth', () => ({ defineAuthenticatedEventHandler: (handler: unknown) => handler, createUserSession: mocks.session }))
vi.mock('~~/server/utils/request-operation-log', () => ({ addRequestOperationLog: mocks.audit }))
vi.mock('~~/server/utils/zod', () => ({ readZodBody: async () => ({ currentPassword: 'old', newPassword: 'new' }) }))
const { default: changePassword } = await import('~~/server/api/user/change-password.post')

describe('password change audit', () => {
  it('audits a committed password change even when replacement session creation is refused', async () => {
    mocks.change.mockResolvedValue({ tokenVersion: 1 })
    mocks.session.mockRejectedValue(Object.assign(new Error('credentials changed again'), { statusCode: 401 }))
    await expect((changePassword as unknown as (event: unknown, user: unknown) => Promise<unknown>)(
      {}, { id: 1, role: 'user', username: 'user' }
    )).rejects.toMatchObject({ statusCode: 401 })
    expect(mocks.audit).toHaveBeenCalledOnce()
    expect(mocks.session).toHaveBeenCalledWith({}, { id: 1, role: 'user' }, { expectedTokenVersion: 1 })
    expect(mocks.audit.mock.invocationCallOrder[0]).toBeLessThan(mocks.session.mock.invocationCallOrder[0]!)
  })
})
