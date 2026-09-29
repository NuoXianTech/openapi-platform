import { and, eq, isNull } from 'drizzle-orm'
import type { DatabaseTransaction } from '~~/server/db/client'
import { db } from '~~/server/db/client'
import { upstreamServiceConnections, upstreamServices } from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { decryptStoredSecret, encryptStoredSecret } from '~~/server/utils/stored-secret'
import { firstRow } from '~~/server/utils/row'
import { afterCommit } from '~~/server/utils/committed-transaction'
import { createLocalSnapshot } from '~~/server/utils/local-snapshot'

type ServiceConnection = typeof upstreamServiceConnections.$inferSelect
const TOKEN_CACHE_TTL_MS = 5_000
const MAX_TOKEN_CACHE_ENTRIES = 1_000

function normalizeToken(value: string): string {
  const token = value?.trim() ?? ''
  if (token.length < 32 || token.length > 4096) {
    throw createApplicationError({
      statusCode: 400,
      message: 'upstreams require a Service Token with 32 to 4096 characters',
      data: { code: 'SERVICE_TOKEN_REQUIRED' }
    })
  }
  return token
}

// Plaintext is kept only in bounded process-local snapshots, never Redis.
function tokenCache(includePending: boolean) {
  return createLocalSnapshot<string, string>({
    ttlMs: TOKEN_CACHE_TTL_MS,
    maxEntries: MAX_TOKEN_CACHE_ENTRIES,
    async load(id) {
      const connection = firstRow(await db.select({
        active: upstreamServiceConnections.serviceTokenCiphertext,
        pending: upstreamServiceConnections.pendingServiceTokenCiphertext
      }).from(upstreamServiceConnections)
        .where(eq(upstreamServiceConnections.upstreamServiceId, id)).limit(1))
      const ciphertext = includePending ? connection?.pending ?? connection?.active : connection?.active
      return ciphertext ? decryptStoredSecret(ciphertext, 'service-token') : ''
    }
  })
}
const activeTokens = tokenCache(false)
const controlTokens = tokenCache(true)

function invalidateAfterCommit(tx: DatabaseTransaction, id: string): void {
  afterCommit(tx, () => upstreamServiceTokenService.invalidate(id))
}

export const upstreamServiceTokenService = {
  async initialize(tx: DatabaseTransaction, id: string, value: string): Promise<ServiceConnection> {
    const token = normalizeToken(value)
    const connection = firstRow(await tx.insert(upstreamServiceConnections).values({
      upstreamServiceId: id,
      serviceTokenCiphertext: encryptStoredSecret(token, 'service-token')
    }).returning())
    if (!connection) throw new Error('Service connection insert returned no row')
    invalidateAfterCommit(tx, id)
    return connection
  },

  async stage(tx: DatabaseTransaction, id: string, value: string): Promise<ServiceConnection> {
    const token = normalizeToken(value)
    const service = firstRow(await tx.select({ id: upstreamServices.id }).from(upstreamServices)
      .where(and(eq(upstreamServices.id, id), isNull(upstreamServices.deletedAt))).limit(1))
    if (!service) {
      throw createApplicationError({ statusCode: 404, message: 'upstream not found', data: { code: 'UPSTREAM_NOT_FOUND' } })
    }
    const connection = firstRow(await tx.update(upstreamServiceConnections).set({
      pendingServiceTokenCiphertext: encryptStoredSecret(token, 'service-token'),
      lastDiscoveryError: 'Service Token changed; run discovery to verify the connection',
      updatedAt: new Date()
    }).where(eq(upstreamServiceConnections.upstreamServiceId, id)).returning())
    if (!connection) {
      throw createApplicationError({ statusCode: 404, message: 'upstream not found', data: { code: 'SERVICE_CONNECTION_NOT_FOUND' } })
    }
    invalidateAfterCommit(tx, id)
    return connection
  },

  /** Discovery must verify this exact observed credential, even when another
   * instance staged it more recently than the control cache TTL. */
  forVerification(connection: Pick<ServiceConnection, 'serviceTokenCiphertext' | 'pendingServiceTokenCiphertext'>): string {
    const ciphertext = connection.pendingServiceTokenCiphertext ?? connection.serviceTokenCiphertext
    return ciphertext ? decryptStoredSecret(ciphertext, 'service-token') : ''
  },

  /** Called inside discovery's fingerprint-checked transaction. A mismatched
   * pending credential cannot be promoted, even if a caller supplies stale data. */
  async promoteVerified(tx: DatabaseTransaction, observed: ServiceConnection): Promise<ServiceConnection> {
    const pending = observed.pendingServiceTokenCiphertext
    if (!pending) return observed
    const connection = firstRow(await tx.update(upstreamServiceConnections).set({
      serviceTokenCiphertext: pending,
      pendingServiceTokenCiphertext: null,
      updatedAt: observed.updatedAt
    }).where(and(
      eq(upstreamServiceConnections.upstreamServiceId, observed.upstreamServiceId),
      eq(upstreamServiceConnections.pendingServiceTokenCiphertext, pending)
    )).returning())
    if (!connection) {
      throw createApplicationError({
        statusCode: 409,
        message: 'Service changed while discovery was running; retry discovery',
        data: { code: 'SERVICE_DISCOVERY_CONFLICT' }
      })
    }
    invalidateAfterCommit(tx, observed.upstreamServiceId)
    return connection
  },

  get(id: string): Promise<string> {
    return activeTokens.get(id)
  },

  getForControl(id: string): Promise<string> {
    return controlTokens.get(id)
  },

  invalidate(id: string): void {
    activeTokens.invalidate(id)
    controlTokens.invalidate(id)
  },

  clearCache(): void {
    activeTokens.clear()
    controlTokens.clear()
  }
}
