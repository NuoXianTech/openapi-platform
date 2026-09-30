import { and, eq } from 'drizzle-orm'
import type {
  RedactedServiceConfigurationState,
  ServiceAvailability,
  ServiceConfigurationDefinition,
  ServiceConfigurationValue,
  ServiceConfigurationView,
  ServiceTargetAvailability,
  ServiceConnectionView,
  ServiceTargetControlState,
  StoredServiceConfigurationValues
} from '#shared/types/service-control'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { withCommittedTransaction } from '~~/server/utils/committed-transaction'
import {
  openapiDocuments,
  upstreamServiceConnections,
  upstreamServices,
  upstreamTargets
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { resolveServiceAvailability } from '~~/server/services/service-availability-service'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'
import { readStoredServiceEndpoints } from '~~/server/services/platform-service-openapi-service'
import {
  defaultServiceConfigurationValues,
  serviceConfigurationFields
} from '~~/server/utils/service-configuration-values'
import { toNullableIsoString } from '~~/server/utils/date'
import { firstRow } from '~~/server/utils/row'
import { canonicalJson } from '~~/server/utils/canonical-json'

export interface PlatformServiceControlContext {
  service: typeof upstreamServices.$inferSelect
  connection: typeof upstreamServiceConnections.$inferSelect
  targets: Array<typeof upstreamTargets.$inferSelect>
}

export interface ServiceViewOptions {
  checkAvailability?: boolean
}

export function toServiceConnectionView(
  connection: typeof upstreamServiceConnections.$inferSelect,
  availability: ServiceAvailability = 'unknown'
): ServiceConnectionView {
  return {
    upstreamServiceId: connection.upstreamServiceId,
    discovered: Boolean(connection.serviceId && connection.serviceDescription),
    availability,
    tokenConfigured: Boolean(
      connection.serviceTokenCiphertext
      || connection.pendingServiceTokenCiphertext
    ),
    serviceId: connection.serviceId,
    serviceName: connection.serviceName,
    serviceVersion: connection.serviceVersion,
    serviceCommit: connection.serviceCommit,
    serviceProtocol: connection.serviceProtocol,
    openapiSha256: connection.openapiSha256,
    configurationSchemaSha256: connection.configurationSchemaSha256,
    configurationRevision: connection.configurationRevision,
    configurationHash: connection.configurationHash,
    lastDiscoveredAt: toNullableIsoString(connection.lastDiscoveredAt),
    lastConfigurationSyncAt: toNullableIsoString(
      connection.lastConfigurationSyncAt
    ),
    lastDiscoveryError: connection.lastDiscoveryError
  }
}

function publicDesiredValues(
  definition: ServiceConfigurationDefinition | null,
  stored: StoredServiceConfigurationValues
): Record<
  string,
  ServiceConfigurationValue | { configured: boolean }
> {
  if (!definition) return {}
  const defaults = defaultServiceConfigurationValues(definition)
  return Object.fromEntries(
    serviceConfigurationFields(definition).map(field => [
      field.key,
      field.type === 'secret'
        ? { configured: Boolean(stored.secrets[field.key]) }
        : stored.values[field.key] ?? defaults[field.key]!
    ])
  )
}

export function serviceTargetControlState(
  target: typeof upstreamTargets.$inferSelect,
  availability: ServiceTargetAvailability
): ServiceTargetControlState {
  return {
    id: target.id,
    baseUrl: target.baseUrl,
    enabled: target.enabled,
    availability,
    configurationRevision: target.configurationRevision,
    configurationHash: target.configurationHash,
    configurationStatus: target.configurationStatus as
      ServiceTargetControlState['configurationStatus'],
    configurationState: target.configurationState ?? null,
    lastConfigurationSyncAt: toNullableIsoString(
      target.lastConfigurationSyncAt
    ),
    lastError: target.lastError
  }
}

export function safeServiceControlError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown error'
  return message.slice(0, 500)
}

export async function loadServiceControlContext(
  upstreamServiceId: string,
  options: {
    transaction?: DatabaseTransaction
    forUpdate?: boolean
  } = {}
): Promise<PlatformServiceControlContext> {
  const executor = options.transaction ?? db
  const contextQuery = executor.select({
    service: upstreamServices,
    connection: upstreamServiceConnections
  }).from(upstreamServices)
    .innerJoin(upstreamServiceConnections, eq(
      upstreamServiceConnections.upstreamServiceId,
      upstreamServices.id
    ))
    .where(and(
      eq(upstreamServices.id, upstreamServiceId)
    ))
    .limit(1)
  const row = firstRow(await (options.forUpdate
    ? contextQuery.for('update')
    : contextQuery))
  if (!row) {
    throw createApplicationError({
      statusCode: 404,
      message: 'Service-managed upstream not found',
      data: { code: 'SERVICE_CONNECTION_NOT_FOUND' }
    })
  }
  const targetsQuery = executor.select().from(upstreamTargets)
    .where(eq(upstreamTargets.upstreamServiceId, upstreamServiceId))
  const targets = await (options.forUpdate
    ? targetsQuery.for('update')
    : targetsQuery)
  return { ...row, targets }
}

function serviceControlFingerprint(context: PlatformServiceControlContext): string {
  return canonicalJson({
    service: {
      openapiDocumentId: context.service.openapiDocumentId,
      status: context.service.status,
      deletedAt: context.service.deletedAt?.toISOString() ?? null,
      updatedAt: context.service.updatedAt.toISOString()
    },
    connection: {
      serviceTokenCiphertext: context.connection.serviceTokenCiphertext,
      pendingServiceTokenCiphertext: context.connection.pendingServiceTokenCiphertext,
      configurationRevision: context.connection.configurationRevision,
      configurationHash: context.connection.configurationHash,
      configurationSchemaSha256: context.connection.configurationSchemaSha256,
      updatedAt: context.connection.updatedAt.toISOString()
    },
    targets: context.targets.map(target => ({
      id: target.id,
      baseUrl: target.baseUrl,
      enabled: target.enabled,
      updatedAt: target.updatedAt.toISOString()
    })).sort((left, right) => left.id.localeCompare(right.id))
  })
}

/** Network results may only change the exact control context they observed.
 * Hold the connection and Target locks through validation and the entire write. */
export async function commitServiceControlContext<T>(
  expected: PlatformServiceControlContext,
  operation: 'discovery' | 'configuration',
  commit: (tx: DatabaseTransaction, current: PlatformServiceControlContext, changedAt: Date) => Promise<T>
): Promise<T> {
  return withCommittedTransaction(async (tx) => {
    const current = await loadServiceControlContext(expected.service.id, {
      transaction: tx,
      forUpdate: true
    })
    if (serviceControlFingerprint(expected) !== serviceControlFingerprint(current)) {
      throw createApplicationError({
        statusCode: 409,
        message: operation === 'discovery'
          ? 'Service changed while discovery was running; retry discovery'
          : 'Service changed while configuration was running; retry configuration',
        data: { code: operation === 'discovery'
          ? 'SERVICE_DISCOVERY_CONFLICT'
          : 'SERVICE_CONFIGURATION_REVISION_CONFLICT' }
      })
    }
    // Keep each accepted write distinguishable even within one clock tick.
    const lastChange = current.targets.reduce(
      (latest, target) => Math.max(latest, target.updatedAt.getTime()),
      Math.max(current.connection.updatedAt.getTime(), current.service.updatedAt.getTime())
    )
    return commit(tx, current, new Date(Math.max(Date.now(), lastChange + 1)))
  })
}

type ServiceTargetResult
  = { ok: true, targetId: string, state: RedactedServiceConfigurationState }
    | { ok: false, targetId: string, error: string }

/** Accept a network observation and its Target state changes under the same
 * context lock. Discovery may update the contract first, in this transaction. */
export async function acceptServiceTargetResults(
  expected: PlatformServiceControlContext,
  operation: 'discovery' | 'configuration',
  results: readonly ServiceTargetResult[],
  updateConnection?: (
    tx: DatabaseTransaction,
    current: PlatformServiceControlContext,
    changedAt: Date
  ) => Promise<PlatformServiceControlContext['connection']>
): Promise<{ status: 'synced' | 'partial' | 'failed', targets: PlatformServiceControlContext['targets'] }> {
  return commitServiceControlContext(expected, operation, async (tx, current, changedAt) => {
    const enabledIds = new Set(current.targets.filter(target => target.enabled).map(target => target.id))
    const observedIds = new Set<string>()
    for (const result of results) {
      if (!enabledIds.has(result.targetId) || observedIds.has(result.targetId)) {
        throw new Error('Target observation must belong to one enabled Target in the accepted context')
      }
      observedIds.add(result.targetId)
    }
    const connection = updateConnection
      ? await updateConnection(tx, current, changedAt)
      : current.connection
    let successful = 0
    const acceptedTargets = new Map(current.targets.map(target => [target.id, target]))
    for (const result of results) {
      const state = result.ok ? result.state : null
      const matches = state !== null
        && connection.configurationHash !== null
        && connection.configurationRevision > 0
        && state.serviceId === connection.serviceId
        && state.schemaSha256 === connection.configurationSchemaSha256
        && state.revision === connection.configurationRevision
        && state.configurationSha256 === connection.configurationHash
      if (matches) successful += 1
      const updated = firstRow(await tx.update(upstreamTargets).set({
        ...(state ? {
          configurationRevision: state.revision,
          configurationHash: state.configurationSha256,
          configurationState: state
        } : {}),
        configurationStatus: !result.ok ? 'error'
          : !connection.configurationHash ? 'unknown'
              : matches ? 'synced' : 'drifted',
        lastError: !result.ok ? result.error
          : operation === 'configuration' && !matches ? 'Service configuration ACK mismatch' : null,
        lastConfigurationSyncAt: changedAt,
        updatedAt: changedAt
      }).where(and(
        eq(upstreamTargets.id, result.targetId),
        eq(upstreamTargets.upstreamServiceId, current.service.id)
      )).returning())
      if (!updated) throw new Error('Target disappeared during result acceptance')
      acceptedTargets.set(updated.id, updated)
    }
    const status = successful > 0 && successful === enabledIds.size
      ? 'synced'
      : successful > 0 ? 'partial' : 'failed'
    if (operation === 'configuration' && status === 'synced') {
      await tx.update(upstreamServiceConnections).set({
        lastConfigurationSyncAt: changedAt,
        updatedAt: changedAt
      }).where(eq(upstreamServiceConnections.upstreamServiceId, current.service.id))
    }
    return { status, targets: [...acceptedTargets.values()] }
  })
}

export async function buildServiceControlView(
  context: PlatformServiceControlContext,
  options: ServiceViewOptions = {}
): Promise<ServiceConfigurationView> {
  const document = context.service.openapiDocumentId
    ? firstRow(await db.select({
        summary: openapiDocuments.parsedSummary
      }).from(openapiDocuments)
        .where(eq(
          openapiDocuments.id,
          context.service.openapiDocumentId
        ))
        .limit(1))
    : null
  const availability = options.checkAvailability === true
    && context.service.status === 'active'
    ? await resolveServiceAvailability(
        context.connection.serviceDescription,
        context.targets,
        await upstreamServiceTokenService.getForControl(context.service.id)
      )
    : { overall: 'unknown' as const, targets: new Map() }
  return {
    connection: toServiceConnectionView(
      context.connection,
      availability.overall
    ),
    definition: context.connection.configurationSchema ?? null,
    values: publicDesiredValues(
      context.connection.configurationSchema ?? null,
      context.connection.configurationValues
    ),
    targets: context.targets.map(target => serviceTargetControlState(
      target,
      availability.targets.get(target.id) ?? 'unknown'
    )),
    endpoints: document ? readStoredServiceEndpoints(document.summary) : []
  }
}

/** Read-only control view shared by management and Endpoint reconciliation. */
export async function getServiceControlView(
  upstreamServiceId: string,
  options: ServiceViewOptions = {}
): Promise<ServiceConfigurationView> {
  return buildServiceControlView(
    await loadServiceControlContext(upstreamServiceId),
    options
  )
}
