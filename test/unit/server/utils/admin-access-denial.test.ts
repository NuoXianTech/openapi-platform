import { describe, expect, it, vi } from 'vitest'

/**
 * 越权拒绝的审计留痕不得改写授权响应。
 *
 * 限流后端在 `required` 模式下不可用时会抛 503。审计是拒绝路径上的附带动作，
 * 授权决定此时已经做完——若这个异常逃出去，一次本该干脆的 403 会变成 503，
 * 并把基础设施状态泄露给一个本来就无权访问的调用方。
 */
const mocks = vi.hoisted(() => ({
  getById: vi.fn(),
  verifyAccessToken: vi.fn(),
  consumeRateLimit: vi.fn(),
  addRequestOperationLog: vi.fn(),
  getSettings: vi.fn()
}))

vi.mock('~~/server/services/user-service', () => ({
  userService: { getById: mocks.getById, clearExpiredBan: vi.fn() }
}))
vi.mock('~~/server/utils/jwt', () => ({
  verifyAccessToken: mocks.verifyAccessToken,
  signAccessToken: vi.fn(() => 'signed')
}))
vi.mock('~~/server/utils/rate-limit/identity', () => ({
  canConsumeIdentityRateLimit: mocks.consumeRateLimit
}))
vi.mock('~~/server/utils/request-operation-log', () => ({
  addRequestOperationLog: mocks.addRequestOperationLog
}))
vi.mock('~~/server/services/system-settings-service', () => ({
  systemSettingsService: { getSettings: mocks.getSettings }
}))
vi.mock('~~/server/services/admin-onboarding-service', () => ({
  assertAdminOnboardingCompleted: vi.fn()
}))

const { requireAdmin, createUserSession } = await import('~~/server/utils/auth')

const NOW_SECONDS = Math.floor(Date.now() / 1000)

function arrangeAuthenticatedNonAdmin() {
  mocks.getSettings.mockResolvedValue({
    sessionMaxAgeSeconds: 86_400,
    sessionAbsoluteMaxAgeSeconds: 604_800,
    sessionRememberMaxAgeSeconds: 2_592_000
  })
  mocks.verifyAccessToken.mockReturnValue({
    sub: 7,
    role: 'user',
    ver: 0,
    loginAt: NOW_SECONDS,
    exp: NOW_SECONDS + 86_400,
    rmb: false
  })
  mocks.getById.mockResolvedValue({
    id: 7,
    username: 'alice',
    email: 'alice@example.com',
    displayName: 'alice',
    role: 'user',
    locale: null,
    tokenVersion: 0,
    isActive: true,
    isBanned: false
  })
}

function fakeEvent() {
  return {
    method: 'POST',
    node: { req: { headers: { cookie: 'app_token=token' }, url: '/api/admin/v1/products' } },
    path: '/api/admin/v1/products',
    headers: new Headers({ cookie: 'app_token=token' })
  } as never
}

describe('admin access denial auditing', () => {
  it('does not issue a replacement session after a newer credential change', async () => {
    arrangeAuthenticatedNonAdmin()
    mocks.getById.mockResolvedValueOnce({ id: 7, role: 'user', tokenVersion: 2 })
    await expect(createUserSession(fakeEvent(), { id: 7 }, { expectedTokenVersion: 1 }))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('still returns 403 when the rate-limit backend is unavailable', async () => {
    arrangeAuthenticatedNonAdmin()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Redis 在 required 模式下不可用。
    mocks.consumeRateLimit.mockRejectedValue(
      Object.assign(new Error('限流服务暂不可用，请稍后再试'), { statusCode: 503, code: 'REDIS_UNAVAILABLE' })
    )

    await expect(requireAdmin(fakeEvent())).rejects.toMatchObject({ statusCode: 403 })
    expect(consoleError).toHaveBeenCalledWith(
      'failed to record admin access denial',
      expect.objectContaining({ userId: 7 })
    )
    consoleError.mockRestore()
  })

  it('still returns 403 when the audit write itself fails', async () => {
    arrangeAuthenticatedNonAdmin()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.consumeRateLimit.mockResolvedValue(true)
    mocks.addRequestOperationLog.mockRejectedValue(new Error('database is down'))

    await expect(requireAdmin(fakeEvent())).rejects.toMatchObject({ statusCode: 403 })
    consoleError.mockRestore()
  })

  it('records the denial once the limiter allows it', async () => {
    arrangeAuthenticatedNonAdmin()
    mocks.consumeRateLimit.mockResolvedValue(true)
    mocks.addRequestOperationLog.mockResolvedValue(undefined)

    await expect(requireAdmin(fakeEvent())).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.addRequestOperationLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 7,
        actor: 'alice',
        action: 'admin.access.denied',
        status: 'failure'
      })
    )
  })

  it('skips the write when the limiter is exhausted but still denies', async () => {
    arrangeAuthenticatedNonAdmin()
    mocks.consumeRateLimit.mockResolvedValue(false)
    mocks.addRequestOperationLog.mockClear()

    await expect(requireAdmin(fakeEvent())).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.addRequestOperationLog).not.toHaveBeenCalled()
  })
})
