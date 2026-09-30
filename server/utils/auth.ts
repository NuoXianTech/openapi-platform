import type { H3Event } from 'h3'
import { createError, defineEventHandler, getCookie, getRequestURL, setCookie, setResponseHeader } from 'h3'
import type { AuthUser } from '#shared/types/auth'
import { assertAdminOnboardingCompleted } from '~~/server/services/admin-onboarding-service'
import { userService } from '~~/server/services/user-service'
import { systemSettingsService } from '~~/server/services/system-settings-service'
import { toHttpError } from '~~/server/utils/http-error'
import { assertSameOriginMutation } from '~~/server/utils/csrf'
import { signAccessToken, verifyAccessToken, type VerifiedToken } from '~~/server/utils/jwt'
import { banMessage, isBanActive } from '~~/server/utils/ban'
import { hostCookieName, hostCookieSecurityOptions } from '~~/server/utils/host-cookie'
import { canConsumeIdentityRateLimit } from '~~/server/utils/rate-limit/identity'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { toAuthUser } from '~~/server/utils/user-view'

interface AuthUserPayload {
  id: number
  role?: 'user' | 'admin'
}

// 会话完全由 JWT 承载、无服务端会话表；此 cookie 装签发的 JWT。
const AUTH_COOKIE_NAME = hostCookieName('app_token')

async function getSessionMaxAgesSeconds() {
  const settings = await systemSettingsService.getSettings()
  return {
    defaultMaxAge: Number(settings.sessionMaxAgeSeconds),
    absoluteMaxAge: Number(settings.sessionAbsoluteMaxAgeSeconds),
    rememberMaxAge: Number(settings.sessionRememberMaxAgeSeconds)
  }
}

function setAuthCookie(event: H3Event, token: string, maxAgeSeconds: number) {
  setCookie(event, AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    ...hostCookieSecurityOptions(),
    maxAge: maxAgeSeconds
  })
}

export function clearAuthCookie(event: H3Event) {
  setCookie(event, AUTH_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    ...hostCookieSecurityOptions(),
    maxAge: 0
  })
}

export async function createUserSession(event: H3Event, user: AuthUserPayload, options: { remember?: boolean, expectedTokenVersion?: number } = {}) {
  const { defaultMaxAge, rememberMaxAge } = await getSessionMaxAgesSeconds()
  const remember = Boolean(options.remember)
  const ttlSeconds = remember ? rememberMaxAge : defaultMaxAge
  // 从 DB 取当前 role/tokenVersion 嵌入 token，避免调用方传入过期角色导致会话降级或越权。
  const row = await userService.getById(user.id)
  if (!row || (options.expectedTokenVersion !== undefined && row.tokenVersion !== options.expectedTokenVersion)) {
    throw createError({ statusCode: 401, message: 'unauthorized' })
  }
  const loginAt = Math.floor(Date.now() / 1000)
  setAuthCookie(event, signAccessToken({ sub: user.id, role: row.role as 'user' | 'admin', ver: row.tokenVersion, loginAt, rmb: remember }, ttlSeconds), ttlSeconds)
}

export function destroyCurrentSession(event: H3Event) {
  // 无状态：登出仅清本机 cookie；服务端全局失效需要自增该用户的 tokenVersion。
  clearAuthCookie(event)
}

// token 剩余寿命不足一半时重签（最新 ver + 原 loginAt + 原 rmb），维持活跃会话不掉线。
// 纯 token 操作、零 DB 写；loginAt 透传以保持绝对硬顶基准不被重置。
async function maybeSlidingRenew(
  event: H3Event,
  payload: VerifiedToken,
  latestVer: number,
  ages: Awaited<ReturnType<typeof getSessionMaxAgesSeconds>>
) {
  const { defaultMaxAge, absoluteMaxAge, rememberMaxAge } = ages
  const ttl = payload.rmb ? rememberMaxAge : defaultMaxAge
  const now = Math.floor(Date.now() / 1000)
  const absoluteDeadline = payload.loginAt + (payload.rmb ? rememberMaxAge : absoluteMaxAge)
  const remainingAbsolute = absoluteDeadline - now
  const remaining = payload.exp - now
  if (remaining >= ttl / 2) {
    return
  }
  const renewalTtl = Math.min(ttl, remainingAbsolute)
  if (renewalTtl <= 0) return
  const fresh = signAccessToken({
    sub: payload.sub,
    role: payload.role,
    ver: latestVer,
    loginAt: payload.loginAt,
    rmb: payload.rmb
  }, renewalTtl)
  setAuthCookie(event, fresh, renewalTtl)
}

/**
 * 解析会话并同时返回对外视图与数据库行。
 *
 * 仅限本模块内部使用：需要 tokenVersion 之类内部字段的鉴权逻辑（初始管理员引导）
 * 从 row 取，对外的处理器只能拿到 view。
 */
async function resolveAuthContext(event: H3Event) {
  const token = getCookie(event, AUTH_COOKIE_NAME)
  if (!token) {
    return null
  }

  const payload = verifyAccessToken(token)
  if (!payload) {
    // 验签失败 / 过期 → 清残留 cookie，等同未登录
    clearAuthCookie(event)
    return null
  }

  // user / admin 都在 users 表：查库拿最新 tokenVersion / 封禁状态 / 资料。
  const user = await userService.getById(payload.sub)
  if (!user) {
    clearAuthCookie(event)
    return null
  }
  if (user.role !== payload.role) {
    clearAuthCookie(event)
    return null
  }

  // tokenVersion 比对：改密 / 重置 / 全局登出后旧 token 立即失效
  if (user.tokenVersion !== payload.ver) {
    clearAuthCookie(event)
    return null
  }

  // Both regular and remembered sessions have an absolute lifetime. Remember
  // Me changes the limit to the configured 30-day window; it is not perpetual.
  const ages = await getSessionMaxAgesSeconds()
  const absoluteMaxAge = payload.rmb ? ages.rememberMaxAge : ages.absoluteMaxAge
  if (Math.floor(Date.now() / 1000) - payload.loginAt >= absoluteMaxAge) {
    clearAuthCookie(event)
    return null
  }
  if (!user.isActive) {
    clearAuthCookie(event)
    return null
  }

  if (user.isBanned) {
    if (isBanActive(user)) {
      clearAuthCookie(event)
      throw createError({ statusCode: 403, message: banMessage(user) })
    }
    // 封禁已到期 → 惰性解封后放行
    await userService.clearExpiredBan(user.id)
  }

  await maybeSlidingRenew(event, payload, user.tokenVersion, ages)

  return { view: toAuthUser(user), row: user }
}

/**
 * 当前登录用户的对外视图。
 *
 * 返回 AuthUser 而不是数据库行：这个值会被 /api/auth/me 原样返回给客户端，
 * 任何内部字段（passwordHash、tokenVersion 等）都不能从这里漏出去。
 */
export async function getAuthUser(event: H3Event): Promise<AuthUser | null> {
  return (await resolveAuthContext(event))?.view ?? null
}

export async function requireAuth(event: H3Event) {
  const user = await getAuthUser(event)
  if (!user || (user.role !== 'user' && user.role !== 'admin')) {
    throw createError({ statusCode: 401, message: 'unauthorized' })
  }
  return user
}

/**
 * 记录一次越权访问管理接口的尝试。
 *
 * 已登录但角色不足 = 一个真实主体主动探测管理接口，这是需要追溯的安全事件。
 * 未登录请求不记：匿名流量可被无限量制造，记录它等于把审计表变成一个由外部
 * 随意写入的表，反而会淹没真实信号并成为存储放大面。
 *
 * 即便已登录，同一账号仍可循环打管理端点刷表，因此按账号限流：每分钟最多留 10 条。
 * 追溯只需要「谁在探测、从什么时候开始」，不需要每一次尝试。
 *
 * 整体包 try/catch：此时授权决定已经做完，剩下的只是留痕。限流后端（Redis）在
 * `required` 模式下不可用时会抛 503，若不拦住，一次本该干脆的 403 会变成 503
 * 并把基础设施状态泄露给无关调用方——一个日志关注点不该改写授权拒绝的响应。
 */
async function recordAdminAccessDenial(event: H3Event, user: AuthUser): Promise<void> {
  try {
    const canRecord = await canConsumeIdentityRateLimit({
      namespace: 'admin-access-denied',
      buckets: [{ name: 'user', value: String(user.id), limit: 10, window: 'minute' }]
    })
    if (!canRecord) return

    await addRequestOperationLog(event, {
      userId: user.id,
      actor: user.username,
      action: 'admin.access.denied',
      resourceType: 'endpoint',
      resourceId: getRequestURL(event).pathname,
      detail: {
        method: event.method,
        role: user.role
      },
      status: 'failure'
    })
  } catch (error) {
    console.error('failed to record admin access denial', { userId: user.id, error })
  }
}

export async function requireAdmin(event: H3Event) {
  const context = await resolveAuthContext(event)
  if (!context || context.view.role !== 'admin') {
    if (context) await recordAdminAccessDenial(event, context.view)
    throw createError({ statusCode: 403, message: 'forbidden' })
  }
  // tokenVersion 只交给管理端鉴权链（初始管理员引导判据），不进入对外视图。
  return { ...context.view, tokenVersion: context.row.tokenVersion }
}
interface AuthorizedEventHandler<TUser, TResult> {
  (event: H3Event, user: TUser): TResult | Promise<TResult>
}

function defineAuthorizedEventHandler<TUser, TResult>(
  authorize: (event: H3Event) => Promise<TUser>,
  handler: AuthorizedEventHandler<TUser, TResult>
) {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, 'cache-control', 'private, no-store')
    try {
      const user = await authorize(event)
      assertSameOriginMutation(event)
      return await handler(event, user)
    } catch (error) {
      throw toHttpError(error)
    }
  })
}

export function defineAuthenticatedEventHandler<TResult>(
  handler: AuthorizedEventHandler<Awaited<ReturnType<typeof requireAuth>>, TResult>
) {
  return defineAuthorizedEventHandler(requireAuth, handler)
}

export function defineAdminEventHandler<TResult>(
  handler: AuthorizedEventHandler<Awaited<ReturnType<typeof requireAdmin>>, TResult>
) {
  return defineAuthorizedEventHandler(requireAdmin, (event, admin) => {
    assertAdminOnboardingCompleted(admin, getRequestURL(event).pathname)
    return handler(event, admin)
  })
}
