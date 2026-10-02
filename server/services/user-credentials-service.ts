import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '~~/server/db/client'
import { users } from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { userService } from '~~/server/services/user-service'
import { systemSettingsService } from '~~/server/services/system-settings-service'
import { getSqlState } from '~~/server/utils/database-error'
import { hashPassword, verifyPassword } from '~~/server/utils/password'
import { firstRow } from '~~/server/utils/row'
import { verifyVerificationToken } from '~~/server/utils/verification-token'
import { banMessage, isBanActive } from '~~/server/utils/ban'

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
  async completeAdminProfile(input: {
    userId: number
    expectedTokenVersion: number
    username?: string
    email?: string
    password: string
  }) {
    const current = await requireUser(input.userId)
    const conflict = () => createApplicationError({ statusCode: 409, message: '账号凭据已变更，请重新登录后重试' })
    if (current.tokenVersion !== input.expectedTokenVersion) throw conflict()
    if (current.role !== 'admin' || !current.isActive) {
      throw createApplicationError({ statusCode: 403, message: 'Forbidden' })
    }
    if (isBanActive(current)) throw createApplicationError({ statusCode: 403, message: banMessage(current) })

    // Blank identity fields keep the observed values; only the password must rotate.
    const username = input.username?.trim() || current.username
    const email = input.email?.trim().toLowerCase() || current.email
    async function checkIdentity() {
      const emailOwner = firstRow(await db.select({ id: users.id }).from(users)
        .where(eq(sql`lower(${users.email})`, email.toLowerCase())).limit(1))
      if (emailOwner && emailOwner.id !== current.id) {
        throw createApplicationError({ statusCode: 409, message: '该邮箱已被注册' })
      }
      const usernameOwner = await userService.findByUsername(username)
      if (usernameOwner && usernameOwner.id !== current.id) {
        throw createApplicationError({ statusCode: 409, message: '该用户名已被占用' })
      }
    }
    await checkIdentity()
    const passwordHash = await hashPassword(input.password)
    try {
      const updated = firstRow(await db.update(users).set({
        username, email, passwordHash,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        updatedAt: new Date()
      }).where(and(
        observedCredentials(current),
        eq(users.username, current.username),
        eq(users.role, current.role),
        eq(users.isActive, current.isActive),
        eq(users.isBanned, current.isBanned),
        current.bannedUntil ? eq(users.bannedUntil, current.bannedUntil) : isNull(users.bannedUntil)
      )).returning())
      if (!updated) throw conflict()
      return {
        updated,
        detail: {
          previous: { username: current.username, email: current.email },
          patch: { usernameChanged: username !== current.username, emailChanged: email !== current.email, passwordChanged: true }
        }
      }
    } catch (error) {
      if (getSqlState(error) === '23505') {
        // Also resolve uniqueness races which happened after the friendly precheck.
        await checkIdentity()
        throw conflict()
      }
      throw error
    }
  },

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
