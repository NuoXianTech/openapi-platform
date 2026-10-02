// OAuth 待绑定身份 → 绑定到「已有账号」：窗口内账密验证账号归属后再 link，然后登录。
import { createError, getHeader } from 'h3'
import { oauthBindSchema } from '~~/server/schemas/auth'
import type { LoginMethod } from '#shared/types/login-log'
import { readZodBody } from '~~/server/utils/zod'
import { readPendingOauth, clearPendingOauth } from '~~/server/utils/oauth-pending'
import { userService } from '~~/server/services/user-service'
import { oauthAccountService } from '~~/server/services/oauth-account-service'
import { loginLogService } from '~~/server/services/login-log-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { createUserSession } from '~~/server/utils/auth'
import { getRateLimiter } from '~~/server/utils/rate-limit'
import { readClientIp, toClientIpRateLimitValue } from '~~/server/utils/request-meta'
import { assertSameOriginMutation } from '~~/server/utils/csrf'

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)
  const pending = readPendingOauth(event)
  if (!pending) {
    throw createError({ statusCode: 410, message: '绑定会话已过期，请重新发起第三方登录' })
  }

  const body = await readZodBody(event, oauthBindSchema)
  const ip = readClientIp(event)
  const userAgent = getHeader(event, 'user-agent') || null
  const method: LoginMethod = pending.provider === 'github' ? 'oauth_github' : 'oauth_qq'

  // 校验密码且未接 Turnstile，按 IP 轻量限流防爆破
  const limiter = getRateLimiter()
  const limit = await limiter.consume(`oauth-bind:ip:${toClientIpRateLimitValue(ip)}`, 10, 'minute')
  if (!limit.allowed) {
    throw createError({ statusCode: 429, message: '尝试次数过多，请稍后再试' })
  }

  const { user, linkedAccount } = await oauthAccountService.bindWithPassword({
    identifier: body.identifier, password: body.password,
    identity: pending, lastLoginIp: ip
  })

  await addRequestOperationLog(event, {
    userId: user.id,
    actor: user.username,
    action: 'user.oauth.bind',
    resourceType: 'oauth-account',
    resourceId: linkedAccount.id,
    detail: { provider: pending.provider, providerUserId: pending.providerUserId }
  })

  clearPendingOauth(event)
  await createUserSession(event, { id: user.id, role: user.role })
  await userService.updateLastLogin(user.id, ip, userAgent)
  await loginLogService.record({ userId: user.id, username: user.username, method, success: true, ip, userAgent })

  return { ok: true }
})
