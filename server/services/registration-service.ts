import type { SystemSettings } from '#shared/types/site-settings'
import type { OauthRegisterInput } from '#shared/types/auth'
import { randomBytes } from 'node:crypto'
import { oauthAccountService, type OauthIdentity } from '~~/server/services/oauth-account-service'
import { userService } from '~~/server/services/user-service'
import { createApplicationError } from '~~/server/errors/application-error'
import { sendDuplicateRegistrationEmail, sendVerificationEmail } from '~~/server/utils/email'
import { issueVerificationTokenUrl, normalizeSiteUrl } from '~~/server/utils/verification-token'
import { hashPassword } from '~~/server/utils/password'
import { getSqlState } from '~~/server/utils/database-error'
import { isEmailAllowedForRegistration, isRegistrationInviteValid, normalizeEmailFilterMode,
  normalizeRegistrationMode, parseEmailDomainList } from '~~/server/utils/registration'

interface PendingRegistrationUser {
  id: number
  email: string
  tokenVersion: number
}

type RegistrationCompletionSettings = Pick<
  SystemSettings,
  'emailActivationEnabled' | 'emailVerifyExpiresInMinutes' | 'siteUrl'
>

interface CompleteRegistrationInput {
  user: PendingRegistrationUser
  settings: RegistrationCompletionSettings
  reasonPrefix: string
}

async function rollbackCreatedUser(userId: number, reason: string, error: unknown): Promise<void> {
  console.error(`[registration] ${reason}, rolling back user`, { userId, error })
  try {
    await userService.deletePendingUser(userId)
  } catch (rollbackError) {
    console.error('[registration] rollback failed', { userId, error: rollbackError })
  }
}

async function completeRegistration(input: CompleteRegistrationInput): Promise<{ verificationRequired: boolean }> {
  const { user, settings, reasonPrefix } = input
  const verificationRequired = settings.emailActivationEnabled !== false

  if (!verificationRequired) {
    try {
      const activated = await userService.activateUser(user.id)
      if (!activated) throw new Error('registration user could not be activated')
    } catch (error) {
      await rollbackCreatedUser(user.id, `${reasonPrefix} auto-activation failed`, error)
      throw createApplicationError({
        statusCode: 503,
        message: '注册失败，请稍后重试或联系管理员'
      })
    }
    return { verificationRequired }
  }

  try {
    const verifyUrl = issueVerificationTokenUrl(user, {
      siteUrl: settings.siteUrl,
      path: 'verify-email',
      purpose: 'verify',
      email: user.email,
      expiresInMinutes: Number(settings.emailVerifyExpiresInMinutes || 30)
    })
    await sendVerificationEmail(user.email, verifyUrl)
  } catch (error) {
    await rollbackCreatedUser(user.id, `${reasonPrefix} verification email failed`, error)
    throw createApplicationError({
      statusCode: 503,
      message: '验证邮件发送失败，请稍后重试或联系管理员检查邮件服务配置'
    })
  }
  return { verificationRequired }
}

async function pickAvailableUsername(base: string) {
  const sanitized = base.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32) || 'user'
  for (let i = 0; i < 5; i++) {
    const candidate = i === 0 ? sanitized : `${sanitized}_${randomBytes(2).toString('hex')}`
    if (!(await userService.findByUsername(candidate))) return candidate
  }
  return `${sanitized}_${randomBytes(4).toString('hex')}`
}

export const registrationService = {
  assertRegistrationPolicy(settings: SystemSettings, email: string, inviteCode?: string) {
    const mode = normalizeRegistrationMode(settings.registrationMode)
    if (mode === 'closed') throw createApplicationError({ statusCode: 403, message: '注册功能已关闭' })
    const filter = normalizeEmailFilterMode(settings.registerEmailFilterMode)
    if (!isEmailAllowedForRegistration(email, filter, parseEmailDomainList(settings.registerEmailFilterList))) {
      throw createApplicationError({ statusCode: 403, message: filter === 'blacklist'
        ? '该邮箱域名已被禁止注册' : '该邮箱域名不在允许注册的列表内' })
    }
    if (mode === 'invite' && !isRegistrationInviteValid(settings.registrationInviteCode, inviteCode)) {
      throw createApplicationError({ statusCode: 403, message: '邀请码无效' })
    }
  },

  /** Completes registration for a verified pending OAuth identity, including compensation. */
  async registerOauth(
    input: OauthRegisterInput & { identity: OauthIdentity, lastLoginIp: string | null },
    settings: SystemSettings
  ) {
    if (settings.oauthForceBinding) {
      throw createApplicationError({ statusCode: 403, message: '站点已设为强制绑定，请绑定已有账号' })
    }
    registrationService.assertRegistrationPolicy(settings, input.email, input.inviteCode)
    if (await userService.findByEmail(input.email)) {
      throw createApplicationError({ statusCode: 409, message: '该邮箱已注册，请改用「绑定已有账号」' })
    }
    const identity = input.identity
    if (await oauthAccountService.findByProviderUserId(identity.provider, identity.providerUserId)) {
      throw createApplicationError({ statusCode: 409, message: '该第三方账号已被绑定，请重新发起登录' })
    }
    let username: string
    if (input.username) {
      if (await userService.findByUsername(input.username)) {
        throw createApplicationError({ statusCode: 409, message: '该用户名已被占用' })
      }
      username = input.username
    } else {
      username = await pickAvailableUsername(identity.nickname || identity.provider)
    }

    const passwordHash = await hashPassword(input.password)
    let user: Awaited<ReturnType<typeof userService.addUser>>
    try {
      user = await userService.addUser({
        username, email: input.email, passwordHash,
        displayName: identity.nickname || username, isActive: false
      })
    } catch (error) {
      if (getSqlState(error) === '23505') {
        throw createApplicationError({ statusCode: 409, message: '邮箱或用户名已被占用，请重新填写' })
      }
      throw error
    }
    let linkedAccount: Awaited<ReturnType<typeof oauthAccountService.bindAccount>>
    try {
      linkedAccount = await oauthAccountService.bindAccount({
        ...identity, userId: user.id, lastLoginIp: input.lastLoginIp
      })
    } catch (error) {
      await rollbackCreatedUser(user.id, 'oauth binding failed', error)
      throw error
    }
    const completion = await completeRegistration({ user, settings, reasonPrefix: 'oauth registration' })
    return { user, linkedAccount, ...completion }
  },

  /** Anonymous registration never reveals an account-dependent outcome, even
   * when activation, delivery or compensation fails. OAuth completion retains
   * its explicit errors for callers holding a verified pending identity. */
  async registerPassword(input: { username: string, email: string, password: string }, settings: SystemSettings) {
    const verificationRequired = settings.emailActivationEnabled !== false
    let user: Awaited<ReturnType<typeof userService.addUser>> | null = null
    try {
      if (await userService.findByEmail(input.email)) {
        await sendDuplicateRegistrationEmail(input.email, `${normalizeSiteUrl(settings.siteUrl)}/login`)
      } else if (!await userService.findByUsername(input.username)) {
        const created = await userService.addUser({
          username: input.username, email: input.email,
          passwordHash: await hashPassword(input.password), isActive: false
        })
        await completeRegistration({ user: created, settings, reasonPrefix: 'password registration' })
        user = created
      }
    } catch (error) {
      console.error('[registration] password registration did not complete', { error })
    }
    return { user, verificationRequired }
  }
}
