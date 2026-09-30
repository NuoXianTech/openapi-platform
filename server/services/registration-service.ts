import type { SystemSettings } from '#shared/types/site-settings'
import { userService } from '~~/server/services/user-service'
import { createApplicationError } from '~~/server/errors/application-error'
import { sendDuplicateRegistrationEmail, sendVerificationEmail } from '~~/server/utils/email'
import { issueVerificationTokenUrl, normalizeSiteUrl } from '~~/server/utils/verification-token'
import { hashPassword } from '~~/server/utils/password'
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

export const registrationService = {
  rollbackCreatedUser,
  completeRegistration,

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
