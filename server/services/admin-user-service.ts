import { and, asc, count, desc, eq, gt, ilike, like, or, sql } from 'drizzle-orm'
import { LOGIN_ACTION_PREFIX } from '#shared/config/audit-actions'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { apiCreditReservations, operationLogs, users } from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { toNumber } from '~~/server/utils/number'
import { normalizePagination } from '~~/server/utils/pagination'
import { firstRow } from '~~/server/utils/row'
import { USER_ROLES, type UserRole } from './user-service'
import type { SupportedLocale } from '#shared/config/locale-defaults'
import type { AdminUserItem } from '#shared/types/admin'
import { toIsoString, toNullableIsoString } from '~~/server/utils/date'

interface AdminAvailabilityUser {
  role: string
  isActive: boolean
  isBanned: boolean
}

interface AdminAccessPatch {
  role?: UserRole
  isActive?: boolean
  isBanned?: boolean
}

interface AdminUserListOptions {
  keyword?: string
  userId?: number
  role?: UserRole
  isActive?: boolean
  isBanned?: boolean
  creditBalance?: 'positive' | 'zero'
  limit?: number
  offset?: number
}

function isAvailableAdmin(user: AdminAvailabilityUser): boolean {
  return user.role === USER_ROLES.admin && user.isActive && !user.isBanned
}

async function lockAvailableAdmins(tx: DatabaseTransaction) {
  return tx.select({ id: users.id }).from(users)
    .where(and(eq(users.role, USER_ROLES.admin), eq(users.isActive, true), eq(users.isBanned, false)))
    .orderBy(asc(users.id))
    .for('update')
}

async function lockAdminAccessChange(tx: DatabaseTransaction, id: number) {
  const availableAdmins = await lockAvailableAdmins(tx)
  const currentRows = await tx.select().from(users).where(eq(users.id, id)).limit(1).for('update')
  return { availableAdmins, current: firstRow(currentRows) }
}

function assertAdminRemainsAvailable(current: AdminAvailabilityUser, availableAdminCount: number): void {
  if (!isAvailableAdmin(current) || availableAdminCount > 1) return
  throw createApplicationError({ statusCode: 400, message: '至少需要保留一个管理员账号' })
}

export const adminUserService = {
  async list(options: AdminUserListOptions = {}) {
    const keyword = options.keyword?.trim().toLowerCase()
    const where = and(
      keyword
        ? or(
            ilike(users.username, `%${keyword}%`),
            ilike(users.email, `%${keyword}%`),
            ilike(users.displayName, `%${keyword}%`)
          )
        : undefined,
      options.userId ? eq(users.id, options.userId) : undefined,
      options.role ? eq(users.role, options.role) : undefined,
      typeof options.isActive === 'boolean' ? eq(users.isActive, options.isActive) : undefined,
      typeof options.isBanned === 'boolean' ? eq(users.isBanned, options.isBanned) : undefined,
      options.creditBalance === 'positive'
        ? gt(users.credits, 0)
        : options.creditBalance === 'zero'
          ? eq(users.credits, 0)
          : undefined
    )
    const { limit, offset } = normalizePagination(options, { defaultLimit: 20 })
    const selection = {
      id: users.id,
      role: users.role,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      credits: users.credits,
      isActive: users.isActive,
      isBanned: users.isBanned,
      bannedReason: users.bannedReason,
      bannedUntil: users.bannedUntil,
      createdAt: users.createdAt
    }
    const [items, totalRows] = await Promise.all([
      db.select(selection).from(users).where(where).orderBy(desc(users.createdAt)).limit(limit).offset(offset),
      db.select({ value: count() }).from(users).where(where)
    ])
    const responseItems: AdminUserItem[] = items.map(item => ({
      ...item,
      bannedReason: item.bannedReason ?? null,
      bannedUntil: toNullableIsoString(item.bannedUntil),
      createdAt: toIsoString(item.createdAt)
    }))
    return { items: responseItems, total: toNumber(totalRows[0]?.value) }
  },

  async listNotificationRecipients() {
    return db.select({ id: users.id, username: users.username, email: users.email })
      .from(users)
      .where(eq(users.isBanned, false))
      .orderBy(asc(users.username))
  },

  async hasAdmin(): Promise<boolean> {
    const rows = await db.select({ id: users.id }).from(users)
      .where(eq(users.role, USER_ROLES.admin))
      .limit(1)
    return Boolean(rows[0])
  },

  willRemoveAdminAccess(user: AdminAvailabilityUser, patch: AdminAccessPatch): boolean {
    return user.role === USER_ROLES.admin
      && (patch.role === USER_ROLES.user || patch.isActive === false || patch.isBanned === true)
  },

  async updateUser(id: number, data: Partial<{
    username: string
    role: UserRole
    email: string
    displayName: string | null
    locale: SupportedLocale | null
    isActive: boolean
    isBanned: boolean
    passwordHash: string
  }>) {
    const removesAdminAccess = data.role === USER_ROLES.user || data.isActive === false || data.isBanned === true
    const values = {
      ...data,
      ...(data.passwordHash ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
      updatedAt: new Date()
    }
    if (!removesAdminAccess) {
      const rows = await db.update(users).set(values).where(eq(users.id, id)).returning()
      return firstRow(rows)
    }

    return db.transaction(async (tx: DatabaseTransaction) => {
      const { availableAdmins, current } = await lockAdminAccessChange(tx, id)
      if (!current) return null
      assertAdminRemainsAvailable(current, availableAdmins.length)
      return firstRow(await tx.update(users).set(values).where(eq(users.id, id)).returning())
    })
  },

  async deleteUser(id: number) {
    return db.transaction(async (tx: DatabaseTransaction) => {
      const { availableAdmins, current } = await lockAdminAccessChange(tx, id)
      if (!current) return null
      assertAdminRemainsAvailable(current, availableAdmins.length)
      // reserve() takes this same user lock before creating a reservation.
      // Do not let the account FK cascade erase unsettled billing intentions.
      const reservation = firstRow(await tx.select({ id: apiCreditReservations.id })
        .from(apiCreditReservations).where(eq(apiCreditReservations.userId, id)).limit(1))
      if (reservation) {
        throw createApplicationError({
          statusCode: 409,
          message: '用户仍有未结算积分，请先在积分流水中完成结算或释放',
          data: { code: 'USER_HAS_CREDIT_RESERVATIONS' }
        })
      }
      await tx.delete(operationLogs).where(and(
        eq(operationLogs.userId, id),
        like(operationLogs.action, `${LOGIN_ACTION_PREFIX}%`)
      ))
      return firstRow(await tx.delete(users).where(eq(users.id, id)).returning())
    })
  },

  async banUser(id: number, isBanned: boolean, options?: { reason?: string | null, bannedUntil?: Date | null }) {
    const values = {
      isBanned,
      bannedReason: isBanned ? (options?.reason?.trim() || null) : null,
      bannedUntil: isBanned ? (options?.bannedUntil ?? null) : null,
      updatedAt: new Date()
    }
    if (!isBanned) {
      return firstRow(await db.update(users).set(values).where(eq(users.id, id)).returning())
    }
    return db.transaction(async (tx: DatabaseTransaction) => {
      const { availableAdmins, current } = await lockAdminAccessChange(tx, id)
      if (!current) return null
      assertAdminRemainsAvailable(current, availableAdmins.length)
      return firstRow(await tx.update(users).set(values).where(eq(users.id, id)).returning())
    })
  }
}
