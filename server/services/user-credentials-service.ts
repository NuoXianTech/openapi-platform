import { and, eq, sql } from 'drizzle-orm'
import { db } from '~~/server/db/client'
import { users } from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { userService } from '~~/server/services/user-service'
import { systemSettingsService } from '~~/server/services/system-settings-service'
import { getSqlState } from '~~/server/utils/database-error'
import { hashPassword, verifyPassword } from '~~/server/utils/password'
import { firstRow } from '~~/server/utils/row'
import { verifyVerificationToken } from '~~/server/utils/verification-token'

type CredentialUser = typeof users.$inferSelect

async function requireUser(id: number): Promise<CredentialUser> {
  const user = await userService.getById(id)
  if (!user) throw createApplicationError({ statusCode: 404, message: 'User not found' })
  return user
}

/** Every write consumes the exact credential state which was verified. Password
 * hashing stays outside the transaction; the conditional UPDATE closes the race. */
function observedCredentials(user: CredentialUser) {
  return and(eq(users.id, user.id), eq(users.email, user.email),
    eq(users.tokenVersion, user.tokenVersion), eq(users.passwordHash, user.passwordHash))
}

async function writePassword(user: CredentialUser, passwordHash: string) {
  return firstRow(await db.update(users).set({
    passwordHash,
    tokenVersion: sql`${users.tokenVersion} + 1`,
    updatedAt: new Date()
  }).where(observedCredentials(user)).returning())
}

function invalidLink(message: string) {
  return createApplicationError({ statusCode: 400, message })
}

export const userCredentialsService = {
  async resetPassword(input: { userId: number, token: string, newPassword: string }) {
    const settings = await systemSettingsService.getSettings()
    if (!settings.passwordResetEnabled) {
      throw createApplicationError({ statusCode: 403, message: '密码重置功能已关闭' })
    }
    const user = await requireUser(input.userId)
    const validate = () => {
      const token = verifyVerificationToken(input.token, user, 'reset_password')
      if (!token || token.email !== user.email) throw invalidLink('Reset link expired or invalid')
    }
    validate()
    const passwordHash = await hashPassword(input.newPassword)
    validate()
    const updated = await writePassword(user, passwordHash)
    if (!updated) throw invalidLink('Reset link expired or invalid')
    return updated
  },

  async changePassword(userId: number, currentPassword: string, newPassword: string) {
    const user = await requireUser(userId)
    if (!await verifyPassword(user.passwordHash, currentPassword)) {
      throw createApplicationError({ statusCode: 400, message: '当前密码不正确' })
    }
    const updated = await writePassword(user, await hashPassword(newPassword))
    if (!updated) {
      throw createApplicationError({ statusCode: 409, message: '账号凭据已变更，请重新登录后重试' })
    }
    return updated
  },

  async confirmEmailChange(userId: number, token: string) {
    const user = await requireUser(userId)
    const payload = verifyVerificationToken(token, user, 'change_email')
    if (!payload || payload.email === user.email) throw invalidLink('Confirmation link expired or invalid')
    try {
      const updated = firstRow(await db.update(users).set({
        email: payload.email,
        emailVerifiedAt: new Date(),
        updatedAt: new Date()
      }).where(observedCredentials(user)).returning())
      if (!updated) throw invalidLink('Confirmation link expired or invalid')
      return updated
    } catch (error) {
      if (getSqlState(error) === '23505') {
        throw createApplicationError({ statusCode: 409, message: 'Email already in use' })
      }
      throw error
    }
  }
}
