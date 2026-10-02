import { and, desc, eq } from 'drizzle-orm'
import { db } from '~~/server/db/client'
import { oauthAccounts } from '~~/server/db/schema'
import { ApplicationError, createApplicationError } from '~~/server/errors/application-error'
import { firstRow } from '~~/server/utils/row'
import { userService } from '~~/server/services/user-service'
import { verifyPassword } from '~~/server/utils/password'
import { banMessage, isBanActive } from '~~/server/utils/ban'
import type { SupportedOauthProvider } from '#shared/types/oauth'
import type { ProviderProfile } from '~~/server/utils/oauth-providers/types'

/** The caller verifies the provider callback or signed pending cookie before binding. */
export interface OauthIdentity extends ProviderProfile {
  provider: SupportedOauthProvider
}

export class OauthBindingError extends ApplicationError {
  constructor(readonly reason: 'already_bound_by_other' | 'already_bound_same_provider') {
    super({
      statusCode: 409,
      message: reason === 'already_bound_by_other'
        ? '该第三方账号已被其他用户绑定'
        : '你已绑定该平台的另一个账号，请先解绑后再绑定'
    })
  }
}

interface OauthAccountBindingInput {
  userId: number
  provider: string
  providerUserId: string
  nickname?: string | null
  avatarUrl?: string | null
  email?: string | null
  lastLoginIp?: string | null
}

async function findByProviderIdentity(provider: string, providerUserId: string) {
  return firstRow(await db.select().from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, provider), eq(oauthAccounts.providerUserId, providerUserId)))
    .limit(1))
}

export const oauthAccountService = {
  async findByProviderUserId(provider: string, providerUserId: string) {
    return findByProviderIdentity(provider, providerUserId)
  },

  /** 查某用户在某 provider 上的绑定（受 (userId, provider) 唯一约束，至多一条） */
  async findByUserAndProvider(userId: number, provider: string) {
    const res = await db.select().from(oauthAccounts)
      .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)))
      .limit(1)
    return firstRow(res)
  },

  /** 用户视角：列出该用户绑定的所有第三方账号，仅返回展示用字段 */
  async listSafeByUserId(userId: number) {
    const rows = await db.select({
      id: oauthAccounts.id,
      provider: oauthAccounts.provider,
      providerUserId: oauthAccounts.providerUserId,
      nickname: oauthAccounts.nickname,
      avatarUrl: oauthAccounts.avatarUrl,
      email: oauthAccounts.email,
      linkedAt: oauthAccounts.linkedAt,
      lastLoginAt: oauthAccounts.lastLoginAt
    })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, userId))
      .orderBy(desc(oauthAccounts.linkedAt))
    return rows
  },

  /** 解绑：要求 (userId, provider) 命中，避免误删别人的绑定 */
  async unbind(userId: number, provider: string) {
    const res = await db.delete(oauthAccounts)
      .where(and(eq(oauthAccounts.userId, userId), eq(oauthAccounts.provider, provider)))
      .returning()
    return firstRow(res)
  },

  /** Bind only after authentication. Ownership checks use the database conflict result. */
  async bindAccount(input: OauthAccountBindingInput) {
    const now = new Date()
    const inserted = await db.insert(oauthAccounts).values({
      userId: input.userId,
      provider: input.provider,
      providerUserId: input.providerUserId,
      nickname: input.nickname ?? null,
      avatarUrl: input.avatarUrl ?? null,
      email: input.email ?? null,
      linkedAt: now,
      lastLoginAt: now,
      lastLoginIp: input.lastLoginIp ?? null
    }).onConflictDoNothing().returning()
    if (inserted[0]) return inserted[0]

    const existing = await findByProviderIdentity(input.provider, input.providerUserId)
    if (!existing || existing.userId !== input.userId) {
      throw new OauthBindingError(existing ? 'already_bound_by_other' : 'already_bound_same_provider')
    }

    const updated = await db.update(oauthAccounts).set({
      nickname: input.nickname ?? existing.nickname,
      avatarUrl: input.avatarUrl ?? existing.avatarUrl,
      email: input.email ?? existing.email,
      lastLoginAt: now,
      lastLoginIp: input.lastLoginIp ?? existing.lastLoginIp,
      updatedAt: now
    }).where(and(
      eq(oauthAccounts.id, existing.id),
      eq(oauthAccounts.userId, input.userId)
    )).returning()
    const account = firstRow(updated)
    if (!account) throw new Error('oauth account update returned no row')
    return account
  },

  async bindWithPassword(input: {
    identifier: string
    password: string
    identity: OauthIdentity
    lastLoginIp: string | null
  }) {
    const user = input.identifier.includes('@')
      ? await userService.findByEmail(input.identifier.toLowerCase())
      : await userService.findByUsername(input.identifier)
    if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
      throw createApplicationError({ statusCode: 401, message: '账号或密码错误' })
    }
    if (user.isBanned && isBanActive(user)) {
      throw createApplicationError({ statusCode: 403, message: banMessage(user) })
    }
    if (user.isBanned) await userService.clearExpiredBan(user.id)
    if (!user.isActive) {
      throw createApplicationError({ statusCode: 403, message: '该账号尚未激活，请先完成邮箱验证后再绑定' })
    }
    const linkedAccount = await oauthAccountService.bindAccount({
      ...input.identity, userId: user.id, lastLoginIp: input.lastLoginIp
    })
    return { user, linkedAccount }
  }
}
