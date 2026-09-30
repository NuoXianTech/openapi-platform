import { createError } from 'h3'
import { registerSchema } from '~~/server/schemas/auth'
import { normalizeRegistrationMode } from '~~/server/utils/registration'
import { readZodBody } from '~~/server/utils/zod'
import { systemSettingsService } from '~~/server/services/system-settings-service'
import { registrationService } from '~~/server/services/registration-service'
import { assertTurnstileForPage } from '~~/server/utils/turnstile'
import { canConsumeIdentityRateLimit } from '~~/server/utils/rate-limit/identity'
import { readClientIp, toClientIpRateLimitValue } from '~~/server/utils/request-meta'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'

// 注册接口对外永远返回中性响应，避免通过 HTTP 状态/文案区分"邮箱已注册 / 用户名已占用 / 注册成功"，
// 防止匿名访问者用接口差异遍历账号库。真实分支信号只走邮件通道。
// 响应里的 verificationRequired 取决于站点是否开启邮件激活：同一激活模式下所有分支返回值一致，
// 不会因"是否需要验证"泄露账号是否存在。

export default defineEventHandler(async (event) => {
  const settings = await systemSettingsService.getSettings()

  // 邮件激活总开关：开启=注册后须邮件验证；关闭=注册即激活、不发验证邮件
  const activationRequired = settings.emailActivationEnabled !== false
  const neutralResponse = { verificationRequired: activationRequired }

  const mode = normalizeRegistrationMode(settings.registrationMode)
  if (mode === 'closed') {
    throw createError({ statusCode: 403, message: '注册功能已关闭' })
  }

  const body = await readZodBody(event, registerSchema)
  const { username, email, password, inviteCode } = body
  const turnstileToken = body.turnstileToken ?? ''

  const ip = readClientIp(event)

  // 先校验 Turnstile：失败时直接抛错，与"邮箱/用户名是否存在"无关，不会构成枚举信号。
  await assertTurnstileForPage('register', turnstileToken, ip)

  // IP 限流先于邀请码校验，避免匿名请求暴力探测邀请码。
  const canRegisterFromIp = await canConsumeIdentityRateLimit({
    namespace: 'register',
    buckets: [{ name: 'ip', value: toClientIpRateLimitValue(ip), limit: 10, window: 'hour' }]
  })
  if (!canRegisterFromIp) return neutralResponse

  registrationService.assertRegistrationPolicy(settings, email, inviteCode)

  // 只有请求通过域名和邀请码策略后才消费邮箱限流；用户输错邀请码后可立即改正。
  const canRegisterEmail = await canConsumeIdentityRateLimit({
    namespace: 'register',
    buckets: [{ name: 'email', value: email, limit: 1, window: 'minute' }]
  })
  if (!canRegisterEmail) return neutralResponse

  const { user: created } = await registrationService.registerPassword({ username, email, password }, settings)
  if (!created) return neutralResponse

  // 只在账号确实创建成功后写审计，与上面各分支的中性返回并不冲突：
  // 审计表不对匿名访问者可见，不构成账号存在性信号。
  // 与 user.oauth.register 对齐，避免密码注册成为唯一无痕的账号创建路径。
  await addRequestOperationLog(event, {
    userId: created.id,
    actor: created.username,
    action: 'user.register',
    resourceType: 'user',
    resourceId: created.id,
    detail: { method: 'password', verificationRequired: activationRequired }
  })
  return neutralResponse
})
