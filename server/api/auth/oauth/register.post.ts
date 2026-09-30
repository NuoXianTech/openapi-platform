// OAuth 待绑定身份 → 「新注册」：用户在窗口确认/填写邮箱后建号并绑定三方身份，
// 随后按站点邮件激活策略：关闭激活则立即登录，开启则发验证邮件、账号待激活。
import { createError, getHeader } from 'h3'
import { randomBytes } from 'node:crypto'
import { oauthRegisterSchema } from '~~/server/schemas/auth'
import type { LoginMethod } from '#shared/types/login-log'
import { readZodBody } from '~~/server/utils/zod'
import { readPendingOauth, clearPendingOauth } from '~~/server/utils/oauth-pending'
import { userService } from '~~/server/services/user-service'
import { oauthAccountService } from '~~/server/services/oauth-account-service'
import { systemSettingsService } from '~~/server/services/system-settings-service'
import { registrationService } from '~~/server/services/registration-service'
import { loginLogService } from '~~/server/services/login-log-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { createUserSession } from '~~/server/utils/auth'
import { hashPassword } from '~~/server/utils/password'
import { normalizeRegistrationMode } from '~~/server/utils/registration'
import { getRateLimiter } from '~~/server/utils/rate-limit'
import { readClientIp, toClientIpRateLimitValue } from '~~/server/utils/request-meta'
import { getSqlState } from '~~/server/utils/database-error'
import { assertSameOriginMutation } from '~~/server/utils/csrf'

function sanitizeUsername(base: string) {
  return base.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'user'
}

async function pickAvailableUsername(base: string) {
  const sanitized = sanitizeUsername(base)
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? sanitized : `${sanitized}_${randomBytes(2).toString('hex')}`
    if (!(await userService.findByUsername(candidate))) {
      return candidate
    }
  }
  return `${sanitized}_${randomBytes(4).toString('hex')}`
}

export default defineEventHandler(async (event) => {
  assertSameOriginMutation(event)
  const pending = readPendingOauth(event)
  if (!pending) {
    throw createError({ statusCode: 410, message: '注册会话已过期，请重新发起第三方登录' })
  }

  const settings = await systemSettingsService.getSettings()
  if (settings.oauthForceBinding) {
    throw createError({ statusCode: 403, message: '站点已设为强制绑定，请绑定已有账号' })
  }
  const registrationMode = normalizeRegistrationMode(settings.registrationMode)
  if (registrationMode === 'closed') {
    throw createError({ statusCode: 403, message: '注册功能已关闭' })
  }

  const body = await readZodBody(event, oauthRegisterSchema)
  const email = body.email
  const ip = readClientIp(event)
  const userAgent = getHeader(event, 'user-agent') || null
  const method: LoginMethod = pending.provider === 'github' ? 'oauth_github' : 'oauth_qq'

  const limiter = getRateLimiter()
  const limit = await limiter.consume(`oauth-register:ip:${toClientIpRateLimitValue(ip)}`, 10, 'hour')
  if (!limit.allowed) {
    throw createError({ statusCode: 429, message: '尝试次数过多，请稍后再试' })
  }

  registrationService.assertRegistrationPolicy(settings, email, body.inviteCode)

  // 邮箱已注册：持有效 pending 的用户应改走「绑定已有账号」
  if (await userService.findByEmail(email)) {
    throw createError({ statusCode: 409, message: '该邮箱已注册，请改用「绑定已有账号」' })
  }
  if (await oauthAccountService.findByProviderUserId(pending.provider, pending.providerUserId)) {
    throw createError({ statusCode: 409, message: '该第三方账号已被绑定，请重新发起登录' })
  }

  // 用户名：提供则校验可用，未提供则由昵称派生
  let username: string
  if (body.username) {
    if (await userService.findByUsername(body.username)) {
      throw createError({ statusCode: 409, message: '该用户名已被占用' })
    }
    username = body.username
  } else {
    username = await pickAvailableUsername(pending.nickname || pending.provider)
  }

  const passwordHash = await hashPassword(body.password)

  let created: Awaited<ReturnType<typeof userService.addUser>>
  try {
    created = await userService.addUser({
      username,
      email,
      passwordHash,
      displayName: pending.nickname || username,
      isActive: false
    })
  } catch (error) {
    if (getSqlState(error) === '23505') {
      throw createError({ statusCode: 409, message: '邮箱或用户名已被占用，请重新填写' })
    }
    throw error
  }

  // 立即把三方身份绑到新账号（用户硬删 / 回滚时 cascade 一并清除）
  let linkedAccount: Awaited<ReturnType<typeof oauthAccountService.upsertAccount>>
  try {
    linkedAccount = await oauthAccountService.upsertAccount({
      userId: created.id,
      provider: pending.provider,
      providerUserId: pending.providerUserId,
      nickname: pending.nickname,
      avatarUrl: pending.avatarUrl,
      email: pending.email,
      lastLoginIp: ip
    })
  } catch (error) {
    await registrationService.rollbackCreatedUser(created.id, 'oauth binding failed', error)
    throw error
  }

  const completion = await registrationService.completeRegistration({
    user: created,
    settings,
    reasonPrefix: 'oauth registration'
  })
  clearPendingOauth(event)

  if (!completion.verificationRequired) {
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
  return { ok: true, verificationRequired: completion.verificationRequired }
})
