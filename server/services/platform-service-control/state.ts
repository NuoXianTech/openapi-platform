import { and, eq } from 'drizzle-orm'
import type { DatabaseTransaction } from '~~/server/db/client'
import { upstreamServiceConnections, upstreamTargets } from '~~/server/db/schema'
import type { RedactedServiceConfigurationState, ServiceConfigurationDefinition, ServiceDescription, StoredServiceConfigurationValues } from '#shared/types/service-control'
import { createApplicationError } from '~~/server/errors/application-error'
import { withCommittedTransaction } from '~~/server/utils/committed-transaction'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { firstRow } from '~~/server/utils/row'
import { buildServiceControlView, loadServiceControlContext, safeServiceControlError, type PlatformServiceControlContext } from '../platform-service-control-context'
import { persistServiceOpenApi, readStoredServiceEndpoints } from '../platform-service-openapi-service'
import { platformEndpointService } from '../platform-endpoint-service'
import { upstreamServiceTokenService } from '../upstream-service-token-service'

export interface ServiceDiscoverySnapshot {
  description: ServiceDescription
  definition: ServiceConfigurationDefinition
  targets: Array<{ targetId: string, state: RedactedServiceConfigurationState }>
  targetErrors: ReadonlyMap<string, string>
  openapi: { document: Record<string, unknown>, reportedSha256: string | null, sourceUrl: string }
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
async function commitServiceControlContext<T>(
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

async function writeServiceTargetResults(
  tx: DatabaseTransaction,
  current: PlatformServiceControlContext,
  changedAt: Date,
  operation: 'discovery' | 'configuration',
  results: readonly ServiceTargetResult[]
): Promise<{ status: 'synced' | 'partial' | 'failed', targets: PlatformServiceControlContext['targets'] }> {
  const enabledIds = validateTargetResults(current, results)
  const connection = current.connection
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
}

function validateTargetResults(current: PlatformServiceControlContext, results: readonly ServiceTargetResult[]) {
  const enabledIds = new Set(current.targets.filter(target => target.enabled).map(target => target.id))
  const observedIds = new Set<string>()
  for (const result of results) {
    if (!enabledIds.has(result.targetId) || observedIds.has(result.targetId)) {
      throw new Error('Target observation must belong to one enabled Target in the accepted context')
    }
    observedIds.add(result.targetId)
  }
  return enabledIds
}

async function commitDiscovery(
  context: PlatformServiceControlContext,
  snapshot: ServiceDiscoverySnapshot
) {
  return commitServiceControlContext(context, 'discovery', async (tx, current, changedAt) => {
    const results = [
      ...snapshot.targets.map(item => ({ ok: true as const, targetId: item.targetId, state: item.state })),
      ...[...snapshot.targetErrors].map(([targetId, error]) => ({ ok: false as const, targetId, error }))
    ]
    validateTargetResults(current, results)
    const schemaChanged = Boolean(
      current.connection.configurationSchemaSha256
      && current.connection.configurationSchemaSha256
      !== snapshot.description.configuration.schemaSha256
    )
    const document = await persistServiceOpenApi({
      upstreamServiceId: current.service.id,
      description: snapshot.description,
      document: snapshot.openapi.document,
      reportedSha256: snapshot.openapi.reportedSha256,
      sourceUrl: snapshot.openapi.sourceUrl,
      transaction: tx
    })
    await platformEndpointService.synchronizeSupportRoutes({
      upstream: current.service,
      serviceName: snapshot.description.name,
      endpoints: readStoredServiceEndpoints(document.parsedSummary),
      transaction: tx
    })

    const firstTargetError = [...snapshot.targetErrors.values()][0]
    const discoveryError = snapshot.targetErrors.size > 0
      ? `${snapshot.targetErrors.size} Service target(s) could not be discovered: ${firstTargetError}`.slice(0, 500)
      : null
    const updatedConnection = firstRow(
      await tx.update(upstreamServiceConnections).set({
        serviceId: snapshot.description.serviceId,
        serviceName: snapshot.description.name,
        serviceVersion: snapshot.description.version,
        serviceCommit: snapshot.description.commit,
        serviceProtocol: snapshot.description.serviceProtocol,
        serviceDescription: snapshot.description,
        openapiSha256: snapshot.description.openapiSha256,
        configurationSchemaSha256:
          snapshot.description.configuration.schemaSha256,
        configurationSchema: snapshot.definition,
        ...(schemaChanged ? { configurationHash: null } : {}),
        lastDiscoveredAt: changedAt,
        lastDiscoveryError: discoveryError,
        updatedAt: changedAt
      }).where(eq(
        upstreamServiceConnections.upstreamServiceId,
        current.service.id
      )).returning()
    )
    if (!updatedConnection) {
      throw new Error('Service connection disappeared during discovery')
    }

    const connection = await upstreamServiceTokenService.promoteVerified(tx, updatedConnection)
    await writeServiceTargetResults(tx, { ...current, connection }, changedAt, 'discovery', results)
    // Read and decode the response while rollback is still possible. No fresh
    // context or OpenAPI read is required after this transaction commits.
    const committed = await loadServiceControlContext(context.service.id, { transaction: tx })
    const view = await buildServiceControlView(committed, { transaction: tx })
    return { context: committed, view }
  })
}

/** Complete state transitions only; callers never receive the write transaction. */
export const serviceControlState = {
  commitDiscovery,

  acceptConfiguration(expected: PlatformServiceControlContext, results: readonly ServiceTargetResult[]) {
    return commitServiceControlContext(expected, 'configuration', (tx, current, changedAt) => (
      writeServiceTargetResults(tx, current, changedAt, 'configuration', results)
    ))
  },

  recordDiscoveryFailure(expected: PlatformServiceControlContext, failure: { error: unknown, targetErrors: ReadonlyMap<string, string> }) {
    return commitServiceControlContext(expected, 'discovery', async (tx, current, changedAt) => {
      const results = [...failure.targetErrors].map(([targetId, error]) => ({ ok: false as const, targetId, error }))
      validateTargetResults(current, results)
      await tx.update(upstreamServiceConnections).set({
        lastDiscoveryError: safeServiceControlError(failure.error), updatedAt: changedAt
      }).where(eq(upstreamServiceConnections.upstreamServiceId, current.service.id))
      await writeServiceTargetResults(tx, current, changedAt, 'discovery', results)
    })
  },

  saveConfiguration(expected: PlatformServiceControlContext, input: {
    revision: number
    configuration?: { values: StoredServiceConfigurationValues, hash: string }
  }): Promise<PlatformServiceControlContext> {
    return commitServiceControlContext(expected, 'configuration', async (tx, current, changedAt) => {
      await tx.update(upstreamServiceConnections).set({
        configurationRevision: input.revision,
        ...(input.configuration ? { configurationValues: input.configuration.values, configurationHash: input.configuration.hash } : {}),
        updatedAt: changedAt
      }).where(eq(upstreamServiceConnections.upstreamServiceId, current.service.id))
      await tx.update(upstreamTargets).set({ configurationStatus: 'unknown', updatedAt: changedAt }).where(and(
        eq(upstreamTargets.upstreamServiceId, current.service.id), eq(upstreamTargets.enabled, true)
      ))
      return loadServiceControlContext(current.service.id, { transaction: tx })
    })
  }
}
