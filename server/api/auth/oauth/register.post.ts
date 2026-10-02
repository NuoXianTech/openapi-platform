// OAuth 待绑定身份 → 「新注册」：用户在窗口确认/填写邮箱后建号并绑定三方身份，
// 随后按站点邮件激活策略：关闭激活则立即登录，开启则发验证邮件、账号待激活。
import { createError, getHeader } from 'h3'
import { oauthRegisterSchema } from '~~/server/schemas/auth'
import type { LoginMethod } from '#shared/types/login-log'
import { readZodBody } from '~~/server/utils/zod'
import { readPendingOauth, clearPendingOauth } from '~~/server/utils/oauth-pending'
import { userService } from '~~/server/services/user-service'
import { systemSettingsService } from '~~/server/services/system-settings-service'
import { registrationService } from '~~/server/services/registration-service'
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
    throw createError({ statusCode: 410, message: '注册会话已过期，请重新发起第三方登录' })
  }

  const settings = await systemSettingsService.getSettings()
  const body = await readZodBody(event, oauthRegisterSchema)
  const ip = readClientIp(event)
  const userAgent = getHeader(event, 'user-agent') || null
  const method: LoginMethod = pending.provider === 'github' ? 'oauth_github' : 'oauth_qq'

  const limiter = getRateLimiter()
  const limit = await limiter.consume(`oauth-register:ip:${toClientIpRateLimitValue(ip)}`, 10, 'hour')
  if (!limit.allowed) {
    throw createError({ statusCode: 429, message: '尝试次数过多，请稍后再试' })
  }

  const { user: created, linkedAccount, verificationRequired } = await registrationService.registerOauth({
    ...body, identity: pending, lastLoginIp: ip
  }, settings)
  clearPendingOauth(event)

  if (!verificationRequired) {
    await createUserSession(event, { id: created.id, role: 'user' })
    await userService.updateLastLogin(created.id, ip, userAgent)
    await loginLogService.record({ userId: created.id, username: created.username, method, success: true, ip, userAgent })
  }

  await addRequestOperationLog(event, {
    userId: created.id,
    actor: created.username,
    action: 'user.oauth.register',
    resourceType: 'oauth-account',
    resourceId: linkedAccount.id,
    detail: { provider: pending.provider }
  })
  return { ok: true, verificationRequired }
})
