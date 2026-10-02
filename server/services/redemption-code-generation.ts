import { randomInt } from 'node:crypto'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { redemptionCodes } from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { clampInteger, toInteger } from '~~/server/utils/number'
import {
  createStoredSecretPreview,
  decryptStoredSecret,
  digestStoredSecret,
  encryptStoredSecret
} from '~~/server/utils/stored-secret'

interface RedemptionGenerationInput {
  amount: number
  count?: number
  maxUses?: number
  expiresAt?: Date | string | null
  note?: string | null
  createdBy?: number | null
}

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const CODE_LENGTH = 32
const MAX_ATTEMPTS = 5

function randomCode(length: number): string {
  return Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
}

function requireFutureExpiry(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
    throw createApplicationError({
      statusCode: 400,
      message: '兑换码过期时间必须是有效的未来时间',
      data: { code: 'REDEMPTION_EXPIRY_INVALID' }
    })
  }
  return date
}

/** Issue a complete batch or none. Expiry and retry semantics belong to this
 * operation, so HTTP callers cannot silently turn invalid expiry into permanence. */
export async function generateRedemptionCodes(input: RedemptionGenerationInput) {
  const amount = Math.max(toInteger(input.amount, 1), 1)
  const count = clampInteger(input.count, 1, 100, 1)
  const maxUses = Math.max(toInteger(input.maxUses, 1), 1)
  const note = (input.note || '').trim().slice(0, 500) || null
  const expiresAt = requireFutureExpiry(input.expiresAt)
  const batchId = `B-${new Date().toISOString().slice(0, 10)}-${randomCode(4)}`

  return db.transaction(async (tx: DatabaseTransaction) => {
    const inserted: Array<typeof redemptionCodes.$inferSelect> = []
    for (let attempt = 0; attempt < MAX_ATTEMPTS && inserted.length < count; attempt++) {
      const rows = Array.from({ length: count - inserted.length }, () => {
        const code = randomCode(CODE_LENGTH)
        return {
          codeDigest: digestStoredSecret(code, 'redemption-code'),
          codeCiphertext: encryptStoredSecret(code, 'redemption-code'),
          codePreview: createStoredSecretPreview(code),
          amount, batchId, note, maxUses, expiresAt,
          usedCount: 0, isEnabled: true, createdBy: input.createdBy ?? null
        }
      })
      // Both existing and intra-batch collisions consume this bounded retry budget.
      inserted.push(...await tx.insert(redemptionCodes).values(rows).onConflictDoNothing({
        target: redemptionCodes.codeDigest
      }).returning())
    }
    if (inserted.length !== count) throw new Error('Redemption code generation conflicts too often')

    // Construct the complete response before committing; decoding failures and an
    // expiry crossed while waiting for the transaction must also roll back the batch.
    const codes = inserted.map(row => ({
      id: row.id,
      code: decryptStoredSecret(row.codeCiphertext, 'redemption-code'),
      amount: row.amount
    }))
    requireFutureExpiry(expiresAt)
    return { batchId, generated: inserted.length, requested: count, codes, amount, maxUses, expiresAt, note }
  })
}
