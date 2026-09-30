import { and, eq, isNull, lte, sql } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { creditTransactions, users } from '~~/server/db/schema'
import { toNumber } from '~~/server/utils/number'
import { expectFirstRow, firstRow } from '~~/server/utils/row'
import { systemSettingsService } from './system-settings-service'
import type { SupportedLocale } from '#shared/config/locale-defaults'

export const USER_ROLES = {
  user: 'user',
  admin: 'admin'
} as const

export type UserRole = typeof USER_ROLES[keyof typeof USER_ROLES]

export const userService = {
  async findByEmail(email: string, options: { role?: UserRole } = {}) {
    const where = options.role
      ? and(eq(users.email, email), eq(users.role, options.role))
      : eq(users.email, email)
    return firstRow(await db.select().from(users).where(where).limit(1))
  },

  async findByUsername(username: string, options: { role?: UserRole } = {}) {
    const where = options.role
      ? and(eq(users.username, username), eq(users.role, options.role))
      : eq(users.username, username)
    return firstRow(await db.select().from(users).where(where).limit(1))
  },

  async getById(id: number) {
    return firstRow(await db.select().from(users).where(eq(users.id, id)).limit(1))
  },

  async addUser(data: {
    username: string
    email: string
    passwordHash: string
    role?: UserRole
    displayName?: string
    isActive?: boolean
    emailVerifiedAt?: Date | null
  }) {
    const rows = await db.insert(users).values({
      role: data.role ?? USER_ROLES.user,
      username: data.username,
      email: data.email,
      passwordHash: data.passwordHash,
      displayName: data.displayName || data.username,
      isActive: data.isActive ?? false,
      emailVerifiedAt: data.emailVerifiedAt ?? null,
      isBanned: false
    }).returning()
    return expectFirstRow(rows, 'Failed to create user.')
  },

  async updateProfile(id: number, data: {
    username?: string
    displayName?: string | null
    locale?: SupportedLocale | null
  }) {
    const rows = await db.update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning()
    return firstRow(rows)
  },

  async updateLastLogin(id: number, ip: string | null, userAgent?: string | null) {
    const rows = await db.update(users).set({
      lastLoginAt: new Date(),
      lastLoginIp: ip,
      lastLoginUserAgent: userAgent ?? null
    }).where(eq(users.id, id)).returning()
    return firstRow(rows)
  },

  async activateUser(id: number) {
    const settings = await systemSettingsService.getSettings()
    const grantAmount = Math.max(Math.trunc(settings.defaultRegisterCredits || 0), 0)
    const activated = await db.transaction(async (tx: DatabaseTransaction) => {
      const rows = await tx.update(users).set({
        isActive: true,
        emailVerifiedAt: new Date()
      }).where(and(eq(users.id, id), isNull(users.emailVerifiedAt))).returning()
      const user = firstRow(rows)
      if (!user) return null
      let activatedUser = user

      if (grantAmount > 0) {
        const updated = await tx.update(users).set({
          credits: sql`${users.credits} + ${grantAmount}`,
          updatedAt: new Date()
        }).where(eq(users.id, id)).returning({ credits: users.credits })
        const balanceAfter = toNumber(updated[0]?.credits)
        await tx.insert(creditTransactions).values({
          userId: id,
          amount: grantAmount,
          balanceAfter,
          reason: 'signup_bonus',
          operatorId: null,
          operatorName: null,
          remark: '注册赠送'
        })
        activatedUser = { ...user, credits: balanceAfter }
      }

      return activatedUser
    })
    return activated
  },

  async clearExpiredBan(id: number) {
    const rows = await db.update(users).set({
      isBanned: false,
      bannedReason: null,
      bannedUntil: null,
      updatedAt: new Date()
    }).where(and(
      eq(users.id, id),
      eq(users.isBanned, true),
      lte(users.bannedUntil, new Date())
    )).returning()
    return firstRow(rows)
  },

  async deletePendingUser(id: number) {
    const rows = await db.delete(users)
      .where(and(eq(users.id, id), eq(users.isActive, false)))
      .returning()
    return firstRow(rows)
  }
}
