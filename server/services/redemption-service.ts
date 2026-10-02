import { and, count, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
import { creditTransactions, redemptionCodes, users } from '~~/server/db/schema'
import { generateRedemptionCodes } from '~~/server/services/redemption-code-generation'
import { toIsoString } from '~~/server/utils/date'
import { getSqlState } from '~~/server/utils/database-error'
import { toNumber } from '~~/server/utils/number'
import { normalizePagination } from '~~/server/utils/pagination'
import { firstRow } from '~~/server/utils/row'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import {
  decryptStoredSecret,
  digestStoredSecret
} from '~~/server/utils/stored-secret'

/**
 * 兑换码服务
 *
 * 核心约束：
 *   1. 兑换码 code 全局唯一，固定 32 位小写字母加数字；批量生成保证去重。
 *   2. (codeId, userId) 唯一：同一用户对同一码只能兑换一次。
 *   3. usedCount < maxUses：用 UPDATE ... WHERE 条件原子递增防超兑。
 *   4. 兑换发生在事务里：递增 usedCount + 加用户积分 + 写流水 + 写 record。
 */

export type RedemptionStatus = 'enabled' | 'disabled' | 'used_up' | 'expired' | 'available'

export interface ListFilters {
  batchId?: string
  status?: RedemptionStatus | 'all'
  keyword?: string // 精确匹配完整 code，或模糊匹配掩码预览 / note
  limit?: number
  offset?: number
}

export interface RevealedRedemptionCode {
  id: number
  code: string
}

interface RedeemInput {
  userId: number
  code: string
  ip?: string | null
}

/**
 * 摘要按小写明文计算，所以归一化必须转小写。大小写输入都能兑换同一张码，
 * 但 0.1.2 之前生成的大写码摘要对不上，属于本次破坏性变更的一部分。
 */
function normalizeCode(raw: string): string {
  return (raw || '').trim().toLowerCase().replace(/\s+/g, '')
}

type StoredRedemptionCodeRecord = typeof redemptionCodes.$inferSelect
type RedemptionCodeRecord = Omit<
  StoredRedemptionCodeRecord,
  'codeDigest' | 'codeCiphertext'
>

function presentRedemptionCodeRecord(row: StoredRedemptionCodeRecord): RedemptionCodeRecord {
  const { codeDigest: _codeDigest, codeCiphertext: _codeCiphertext, ...record } = row
  return record
}

export const redemptionService = {
  generate: generateRedemptionCodes,

  async list(filters: ListFilters = {}) {
    const { limit, offset } = normalizePagination(filters)
    const conditions: SQL[] = []

    if (filters.batchId) conditions.push(eq(redemptionCodes.batchId, filters.batchId))

    const now = new Date()
    if (filters.status === 'disabled') conditions.push(eq(redemptionCodes.isEnabled, false))
    else if (filters.status === 'used_up') conditions.push(sql`${redemptionCodes.usedCount} >= ${redemptionCodes.maxUses}`)
    else if (filters.status === 'expired') {
      conditions.push(and(
        sql`${redemptionCodes.expiresAt} is not null`,
        lt(redemptionCodes.expiresAt, now)
      )!)
    } else if (filters.status === 'available') {
      conditions.push(eq(redemptionCodes.isEnabled, true))
      conditions.push(sql`${redemptionCodes.usedCount} < ${redemptionCodes.maxUses}`)
      conditions.push(or(
        isNull(redemptionCodes.expiresAt),
        gte(redemptionCodes.expiresAt, now)
      )!)
    }

    if (filters.keyword?.trim()) {
      const keyword = filters.keyword.trim()
      const normalizedCode = normalizeCode(keyword)
      const kw = `%${keyword}%`
      conditions.push(or(
        normalizedCode ? eq(redemptionCodes.codeDigest, digestStoredSecret(normalizedCode, 'redemption-code')) : undefined,
        ilike(redemptionCodes.codePreview, kw),
        ilike(redemptionCodes.note, kw)
      )!)
    }

    const where = conditions.length ? and(...conditions) : undefined

    const [items, totalRows] = await Promise.all([
      where
        ? db.select().from(redemptionCodes).where(where).orderBy(desc(redemptionCodes.createdAt)).limit(limit).offset(offset)
        : db.select().from(redemptionCodes).orderBy(desc(redemptionCodes.createdAt)).limit(limit).offset(offset),
      where
        ? db.select({ value: count() }).from(redemptionCodes).where(where)
        : db.select({ value: count() }).from(redemptionCodes)
    ])

    return {
      items: items.map(presentRedemptionCodeRecord),
      total: toNumber(totalRows[0]?.value)
    }
  },

  async reveal(id: number): Promise<RevealedRedemptionCode | null> {
    const row = firstRow(await db.select({
      id: redemptionCodes.id,
      codeCiphertext: redemptionCodes.codeCiphertext
    }).from(redemptionCodes).where(eq(redemptionCodes.id, id)).limit(1))

    return row
      ? {
          id: row.id,
          code: decryptStoredSecret(row.codeCiphertext, 'redemption-code')
        }
      : null
  },

  /** 列出所有批次（按最新创建时间倒序） */
  async listBatches(limit: number = 50) {
    const { limit: normalizedLimit } = normalizePagination({ limit })
    const rows = await db.select({
      batchId: redemptionCodes.batchId,
      note: sql<string | null>`max(${redemptionCodes.note})`,
      amount: sql<number>`max(${redemptionCodes.amount})`,
      total: sql<number>`count(*)`,
      usedTotal: sql<number>`coalesce(sum(${redemptionCodes.usedCount}), 0)`,
      maxUsesTotal: sql<number>`coalesce(sum(${redemptionCodes.maxUses}), 0)`,
      createdAt: sql<Date>`max(${redemptionCodes.createdAt})`
    })
      .from(redemptionCodes)
      .where(sql`${redemptionCodes.batchId} is not null`)
      .groupBy(redemptionCodes.batchId)
      .orderBy(sql`max(${redemptionCodes.createdAt}) desc`)
      .limit(normalizedLimit)

    type BatchRow = {
      batchId: string | null
      note: string | null
      amount: number
      total: number
      usedTotal: number
      maxUsesTotal: number
      createdAt: Date
    }
    return rows.filter((r: BatchRow) => r.batchId).map((r: BatchRow) => ({
      batchId: r.batchId as string,
      note: r.note,
      amount: toNumber(r.amount),
      total: toNumber(r.total),
      usedTotal: toNumber(r.usedTotal),
      maxUsesTotal: toNumber(r.maxUsesTotal),
      createdAt: toIsoString(r.createdAt)
    }))
  },

  /** 启用/禁用单张码。返回受影响行数，0 表示码不存在。 */
  async toggle(id: number, enabled: boolean) {
    const res = await db.update(redemptionCodes)
      .set({ isEnabled: enabled, updatedAt: new Date() })
      .where(eq(redemptionCodes.id, id))
      .returning({ id: redemptionCodes.id })
    return { affected: res.length }
  },

  /** 批量启用/禁用整个批次 */
  async toggleBatch(batchId: string, enabled: boolean) {
    const res = await db.update(redemptionCodes)
      .set({ isEnabled: enabled, updatedAt: new Date() })
      .where(eq(redemptionCodes.batchId, batchId))
      .returning({ id: redemptionCodes.id })
    return { affected: res.length }
  },

  /** 删除单张码。返回受影响行数，0 表示码不存在。 */
  async remove(id: number) {
    const res = await db.delete(redemptionCodes)
      .where(eq(redemptionCodes.id, id))
      .returning({ id: redemptionCodes.id })
    return { affected: res.length }
  },

  /** 删除整个批次（仅未被使用过的码会被删除，已被使用的保留以保证审计） */
  async removeBatch(batchId: string, includeUsed: boolean) {
    if (includeUsed) {
      const res = await db.delete(redemptionCodes).where(eq(redemptionCodes.batchId, batchId)).returning({ id: redemptionCodes.id })
      return { affected: res.length }
    }
    const res = await db.delete(redemptionCodes)
      .where(and(eq(redemptionCodes.batchId, batchId), eq(redemptionCodes.usedCount, 0)))
      .returning({ id: redemptionCodes.id })
    return { affected: res.length }
  },

  /**
   * 用户兑换：在事务里完成
   *   1. 校验 code 存在 + isEnabled + 未过期 + usedCount < maxUses + (codeId,userId) 不存在
   *   2. UPDATE redemption_codes SET used_count = used_count + 1 WHERE used_count < max_uses AND ...
   *      → 失败说明并发竞争已抢光，抛 USED_UP
   *   3. UPDATE users SET credits = credits + amount RETURNING new credits
   *   4. INSERT credit_transactions（含 codeId/ip 快照；(codeId,userId) 部分唯一索引兜底重复兑换）
   */
  async redeem(input: RedeemInput) {
    const code = normalizeCode(input.code)
    if (!code) throw createRedemptionError('INVALID_CODE', '兑换码不能为空')

    const codeDigest = digestStoredSecret(code, 'redemption-code')
    const found = await db.select().from(redemptionCodes).where(eq(redemptionCodes.codeDigest, codeDigest)).limit(1)
    const target = found[0]
    if (!target) throw createRedemptionError('NOT_FOUND', '兑换码不存在')
    if (!target.isEnabled) throw createRedemptionError('DISABLED', '兑换码已被禁用')
    if (target.expiresAt && target.expiresAt.getTime() <= Date.now()) {
      throw createRedemptionError('EXPIRED', '兑换码已过期')
    }
    if (target.usedCount >= target.maxUses) {
      throw createRedemptionError('USED_UP', '兑换码已被领完')
    }

    // 同一用户重复兑换：用 creditTransactions (codeId, userId) 部分唯一索引兜底；
    // 这里先做一次显式查询给出更友好错误。
    const dup = await db.select({ id: creditTransactions.id })
      .from(creditTransactions)
      .where(and(
        eq(creditTransactions.codeId, target.id),
        eq(creditTransactions.userId, input.userId),
        eq(creditTransactions.reason, 'redemption_code')
      ))
      .limit(1)
    if (dup[0]) throw createRedemptionError('ALREADY_REDEEMED', '你已兑换过该兑换码')

    return db.transaction(async (tx: DatabaseTransaction) => {
      // 原子递增 usedCount，竞争失败说明被别人抢走
      const consumed = await tx.update(redemptionCodes)
        .set({ usedCount: sql`${redemptionCodes.usedCount} + 1`, updatedAt: new Date() })
        .where(and(
          eq(redemptionCodes.id, target.id),
          eq(redemptionCodes.isEnabled, true),
          sql`${redemptionCodes.usedCount} < ${redemptionCodes.maxUses}`,
          or(isNull(redemptionCodes.expiresAt), gte(redemptionCodes.expiresAt, new Date()))!
        ))
        .returning({ id: redemptionCodes.id, amount: redemptionCodes.amount })
      if (!consumed[0]) {
        throw createRedemptionError('USED_UP', '兑换码已被领完')
      }

      const grantAmount = Math.max(Math.trunc(consumed[0].amount), 0)

      // 加积分
      const userUpdated = await tx.update(users)
        .set({ credits: sql`${users.credits} + ${grantAmount}`, updatedAt: new Date() })
        .where(eq(users.id, input.userId))
        .returning({ id: users.id, credits: users.credits })
      if (!userUpdated[0]) {
        throw createRedemptionError('USER_NOT_FOUND', '用户不存在')
      }
      const balanceAfter = toNumber(userUpdated[0].credits)

      // 写流水（兑换记录已并入 credit_transactions）：codeId 关联兑换码、ip 记录来源，
      // meta 仅保留掩码与批次快照；完整兑换码只通过管理员专用接口恢复。
      // (codeId, userId) 部分唯一索引兜底重复兑换 —— 冲突即事务回滚，usedCount 与积分一并撤销。
      try {
        await tx.insert(creditTransactions).values({
          userId: input.userId,
          amount: grantAmount,
          balanceAfter,
          reason: 'redemption_code',
          apiCallId: null,
          codeId: target.id,
          operatorId: null,
          operatorName: null,
          ip: input.ip ?? null,
          remark: target.note || null,
          meta: {
            codePreview: target.codePreview,
            batchId: target.batchId
          }
        })
      } catch (error) {
        if (getSqlState(error) !== '23505') throw error
        throw createRedemptionError('ALREADY_REDEEMED', '你已兑换过该兑换码', error)
      }

      return {
        amount: grantAmount,
        balanceAfter,
        codeId: target.id,
        code,
        batchId: target.batchId
      }
    })
  },

  /** 用户视角：自己的兑换记录（即 reason='redemption_code' 的积分流水） */
  async listUserRedemptions(userId: number, limit: number = 50, offset: number = 0) {
    const pagination = normalizePagination({ limit, offset })
    const where = and(
      eq(creditTransactions.userId, userId),
      eq(creditTransactions.reason, 'redemption_code')
    )
    const [items, totalRows] = await Promise.all([
      db.select({
        id: creditTransactions.id,
        codeId: creditTransactions.codeId,
        meta: creditTransactions.meta,
        amount: creditTransactions.amount,
        redeemedAt: creditTransactions.createdAt,
        note: creditTransactions.remark // redeem 时 remark = 兑换码 note 快照
      })
        .from(creditTransactions)
        .where(where)
        .orderBy(desc(creditTransactions.createdAt))
        .limit(pagination.limit)
        .offset(pagination.offset),
      db.select({ value: count() }).from(creditTransactions).where(where)
    ])
    return {
      items: items.map((item: {
        id: number
        codeId: number | null
        meta: Record<string, unknown> | null
        amount: number
        redeemedAt: Date
        note: string | null
      }) => {
        const preview = typeof item.meta?.codePreview === 'string'
          ? item.meta.codePreview
          : null
        return {
          id: item.id,
          codeId: item.codeId,
          code: preview,
          amount: item.amount,
          redeemedAt: item.redeemedAt,
          note: item.note
        }
      }),
      total: toNumber(totalRows[0]?.value)
    }
  }
}

export interface RedemptionError extends Error {
  readonly code: string
  readonly cause?: unknown
}

function createRedemptionError(code: string, message: string, cause?: unknown): RedemptionError {
  return Object.assign(new Error(message), {
    name: 'RedemptionError',
    code,
    ...(cause === undefined ? {} : { cause })
  })
}

export function isRedemptionError(error: unknown): error is RedemptionError {
  return error instanceof Error
    && error.name === 'RedemptionError'
    && typeof (error as { code?: unknown }).code === 'string'
}
