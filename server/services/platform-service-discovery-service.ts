import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type {
  RedactedServiceConfigurationState,
  ServiceConfigurationDefinition,
  ServiceDescription
} from '#shared/types/service-control'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import {
  upstreamServiceConnections,
  upstreamTargets
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import {
  buildServiceControlView,
  loadServiceControlContext,
  safeServiceControlError,
  type PlatformServiceControlContext
} from '~~/server/services/platform-service-control-context'
import {
  persistServiceOpenApi,
  readStoredServiceEndpoints
} from '~~/server/services/platform-service-openapi-service'
import { applyPlatformRevision } from '~~/server/services/platform-endpoint-publication-service'
import { platformEndpointService } from '~~/server/services/platform-endpoint-service'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { firstRow } from '~~/server/utils/row'
import {
  UnsupportedServiceProtocolError,
  serviceControlClient
} from '~~/server/utils/service-control-client'
import { assertServiceConfigurationDefinition } from '~~/server/utils/service-configuration-values'
import { hasReadyServiceTarget } from '~~/server/utils/service-upstream-readiness'

interface DiscoveredTarget {
  targetId: string
  description: ServiceDescription
  definition: ServiceConfigurationDefinition
  state: RedactedServiceConfigurationState
}

interface DiscoveryFetchSuccess {
  ok: true
  targets: DiscoveredTarget[]
  // A healthy subset is enough to refresh the contract. Failed Targets are
  // persisted as degraded instead of blocking the whole Service fleet.
  targetErrors: ReadonlyMap<string, string>
  description: ServiceDescription
  openapi: {
    document: Record<string, unknown>
    reportedSha256: string | null
    sourceUrl: string
  }
}

interface DiscoveryFetchFailure {
  ok: false
  error: unknown
  targetErrors: ReadonlyMap<string, string>
}

type DiscoveryFetchResult = DiscoveryFetchSuccess | DiscoveryFetchFailure

const activeDiscoveries = new Map<
  string,
  ReturnType<typeof performPlatformServiceDiscovery>
>()
const DISCOVERY_CONCURRENCY = 8

async function allSettledBounded<TItem, TResult>(
  items: readonly TItem[],
  worker: (item: TItem) => Promise<TResult>,
  concurrency: number
): Promise<PromiseSettledResult<TResult>[]> {
  const results: PromiseSettledResult<TResult>[] = []
  let nextIndex = 0
  const runWorker = async () => {
    while (true) {
      const index = nextIndex++
      const item = items[index]
      if (item === undefined && index >= items.length) return
      try {
        results[index] = {
          status: 'fulfilled',
          value: await worker(item as TItem)
        }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(Array.from({
    length: Math.min(Math.max(concurrency, 1), items.length)
  }, runWorker))
  return results
}

function descriptionContractFingerprint(description: ServiceDescription): string {
  return createHash('sha256')
    .update(canonicalJson({
      serviceId: description.serviceId,
      name: description.name,
      serviceProtocol: description.serviceProtocol,
      openapiSha256: description.openapiSha256,
      configurationSchemaSha256: description.configuration.schemaSha256,
      openapi: description.openapi,
      configurationSchema: description.configuration.schema,
      configurationState: description.configuration.state,
      configurationUpdate: description.configuration.update,
      health: description.health,
      readiness: description.readiness
    }))
    .digest('hex')
}

export function selectCompatibleTargets<
  TTarget extends { targetId: string, description: ServiceDescription }
>(
  targets: TTarget[],
  targetErrors: Map<string, string>,
  currentDescription: ServiceDescription | null
): { description: ServiceDescription, targets: TTarget[] } {
  if (targets.length === 0) throw new Error('service has no enabled targets')

  const cohorts = new Map<string, TTarget[]>()
  for (const target of targets) {
    const fingerprint = descriptionContractFingerprint(target.description)
    const cohort = cohorts.get(fingerprint) ?? []
    cohort.push(target)
    cohorts.set(fingerprint, cohort)
  }

  const currentFingerprint = currentDescription
    ? descriptionContractFingerprint(currentDescription)
    : null
  const currentCohort = currentFingerprint
    ? cohorts.get(currentFingerprint)
    : undefined
  const selected = currentCohort ?? [...cohorts.entries()]
    .sort(([leftFingerprint, left], [rightFingerprint, right]) => (
      right.length - left.length
      || leftFingerprint.localeCompare(rightFingerprint)
    ))[0]![1]
  selected.sort((left, right) => left.targetId.localeCompare(right.targetId))
  const selectedIds = new Set(selected.map(target => target.targetId))
  for (const target of targets) {
    if (selectedIds.has(target.targetId)) continue
    targetErrors.set(
      target.targetId,
      'upstream Target exposes a different Service contract'
    )
  }
  return { description: selected[0]!.description, targets: selected }
}

function discoveryContextFingerprint(
  context: PlatformServiceControlContext
): string {
  return canonicalJson({
    service: {
      openapiDocumentId: context.service.openapiDocumentId,
      updatedAt: context.service.updatedAt.toISOString()
    },
    connection: {
      serviceTokenCiphertext: context.connection.serviceTokenCiphertext,
      pendingServiceTokenCiphertext:
        context.connection.pendingServiceTokenCiphertext,
      updatedAt: context.connection.updatedAt.toISOString()
    },
    targets: context.targets
      .map(target => ({
        id: target.id,
        baseUrl: target.baseUrl,
        enabled: target.enabled,
        updatedAt: target.updatedAt.toISOString()
      }))
      .sort((left, right) => left.id.localeCompare(right.id))
  })
}

async function loadCurrentDiscoveryContext(
  tx: DatabaseTransaction,
  upstreamServiceId: string
) {
  return loadServiceControlContext(upstreamServiceId, {
    transaction: tx,
    forUpdate: true
  })
}

function assertDiscoveryContextCurrent(
  expected: PlatformServiceControlContext,
  current: PlatformServiceControlContext
) {
  if (
    discoveryContextFingerprint(expected)
    !== discoveryContextFingerprint(current)
  ) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service changed while discovery was running; retry discovery',
      data: { code: 'SERVICE_DISCOVERY_CONFLICT' }
    })
  }
}

async function fetchServiceSnapshot(
  context: PlatformServiceControlContext,
  token: string
): Promise<DiscoveryFetchResult> {
  const enabledTargets = context.targets.filter(target => target.enabled)
  const targetResults = await allSettledBounded(
    enabledTargets,
    async (target): Promise<DiscoveredTarget> => {
      const description = await serviceControlClient.getDescription(
        target.baseUrl,
        token
      )
      const [definition, state] = await Promise.all([
        serviceControlClient.getConfigurationDefinition(
          target.baseUrl,
          description.data.configuration.schema,
          token
        ),
        serviceControlClient.getConfigurationState(
          target.baseUrl,
          description.data.configuration.state,
          token
        )
      ])
      const schemaSha256 = createHash('sha256')
        .update(canonicalJson(definition.data))
        .digest('hex')
      assertServiceConfigurationDefinition(definition.data)
      if (
        description.headers.get('x-openapi-sha256')
        !== description.data.openapiSha256
      ) {
        throw createApplicationError({
          statusCode: 409,
          message: 'Service description fingerprint mismatch',
          data: { code: 'SERVICE_OPENAPI_HASH_MISMATCH' }
        })
      }
      if (
        schemaSha256 !== description.data.configuration.schemaSha256
        || definition.headers.get('x-configuration-schema-sha256')
        !== schemaSha256
        || state.data.serviceId !== description.data.serviceId
        || state.data.schemaSha256 !== schemaSha256
      ) {
        throw createApplicationError({
          statusCode: 409,
          message: 'Service configuration fingerprint mismatch',
          data: { code: 'SERVICE_CONFIGURATION_HASH_MISMATCH' }
        })
      }
      return {
        targetId: target.id,
        description: description.data,
        definition: definition.data,
        state: state.data
      }
    },
    DISCOVERY_CONCURRENCY
  )

  const targetErrors = new Map<string, string>()
  targetResults.forEach((result, index) => {
    if (result.status === 'rejected') {
      targetErrors.set(
        enabledTargets[index]!.id,
        safeServiceControlError(result.reason)
      )
    }
  })
  const targets = targetResults.flatMap(result => (
    result.status === 'fulfilled' ? [result.value] : []
  ))
  if (targets.length === 0) {
    const firstError = targetResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    )!.reason
    const protocolError = targetResults.find(
      (result): result is PromiseRejectedResult => (
        result.status === 'rejected'
        && result.reason instanceof UnsupportedServiceProtocolError
      )
    )?.reason
    if (protocolError instanceof UnsupportedServiceProtocolError) {
      return {
        ok: false,
        error: createApplicationError({
          statusCode: 409,
          message: protocolError.message,
          data: {
            code: 'SERVICE_PROTOCOL_UNSUPPORTED',
            serviceProtocol: protocolError.serviceProtocol,
            supportedProtocols: protocolError.supportedProtocols
          }
        }),
        targetErrors
      }
    }
    return {
      ok: false,
      error: createApplicationError({
        statusCode: 502,
        message: `one or more Service targets could not be discovered: ${safeServiceControlError(firstError)}`,
        data: {
          code: 'SERVICE_DISCOVERY_FAILED',
          failedTargets: targetErrors.size
        }
      }),
      targetErrors
    }
  }

  try {
    const compatible = selectCompatibleTargets(
      targets,
      targetErrors,
      context.connection.serviceDescription
    )
    const description = compatible.description
    if (
      context.connection.serviceId
      && context.connection.serviceId !== description.serviceId
    ) {
      throw createApplicationError({
        statusCode: 409,
        message: 'discovered Service identity differs from the existing connection',
        data: { code: 'SERVICE_IDENTITY_MISMATCH' }
      })
    }
    const first = compatible.targets[0]!
    const firstTarget = context.targets.find(
      target => target.id === first.targetId
    )!
    const openapi = await serviceControlClient.getOpenAPI(
      firstTarget.baseUrl,
      description.openapi,
      token
    )
    return {
      ok: true,
      targets: compatible.targets,
      targetErrors,
      description,
      openapi: {
        document: openapi.data,
        reportedSha256: openapi.headers.get('x-openapi-sha256'),
        sourceUrl: openapi.url
      }
    }
  } catch (error) {
    return { ok: false, error, targetErrors }
  }
}

async function recordDiscoveryFailure(
  context: PlatformServiceControlContext,
  failure: DiscoveryFetchFailure
) {
  await db.transaction(async (tx) => {
    const current = await loadCurrentDiscoveryContext(tx, context.service.id)
    if (
      discoveryContextFingerprint(context)
      !== discoveryContextFingerprint(current)
    ) return

    const now = new Date()
    for (const [targetId, message] of failure.targetErrors) {
      await tx.update(upstreamTargets).set({
        configurationStatus: 'error',
        lastError: message,
        lastConfigurationSyncAt: now,
        updatedAt: now
      }).where(eq(upstreamTargets.id, targetId))
    }
    await tx.update(upstreamServiceConnections).set({
      lastDiscoveryError: safeServiceControlError(failure.error),
      updatedAt: now
    }).where(eq(
      upstreamServiceConnections.upstreamServiceId,
      context.service.id
    ))
  }).catch(() => undefined)
}

async function commitServiceSnapshot(
  context: PlatformServiceControlContext,
  snapshot: DiscoveryFetchSuccess
) {
  await db.transaction(async (tx) => {
    const current = await loadCurrentDiscoveryContext(tx, context.service.id)
    assertDiscoveryContextCurrent(context, current)

    const first = snapshot.targets[0]!
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

    const now = new Date()
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
        configurationSchema: first.definition,
        ...(current.connection.pendingServiceTokenCiphertext
          ? {
              serviceTokenCiphertext:
                current.connection.pendingServiceTokenCiphertext,
              pendingServiceTokenCiphertext: null
            }
          : {}),
        ...(schemaChanged ? { configurationHash: null } : {}),
        lastDiscoveredAt: now,
        lastDiscoveryError: discoveryError,
        updatedAt: now
      }).where(eq(
        upstreamServiceConnections.upstreamServiceId,
        current.service.id
      )).returning()
    )
    if (!updatedConnection) {
      throw new Error('Service connection disappeared during discovery')
    }

    for (const item of snapshot.targets) {
      const matchesDesired = updatedConnection.configurationHash !== null
        && updatedConnection.configurationRevision > 0
        && item.state.revision === updatedConnection.configurationRevision
        && item.state.configurationSha256 === updatedConnection.configurationHash
      await tx.update(upstreamTargets).set({
        configurationRevision: item.state.revision,
        configurationHash: item.state.configurationSha256,
        configurationStatus: !updatedConnection.configurationHash
          ? 'unknown'
          : matchesDesired ? 'synced' : 'drifted',
        configurationState: item.state,
        lastConfigurationSyncAt: now,
        lastError: null,
        updatedAt: now
      }).where(eq(upstreamTargets.id, item.targetId))
    }
    for (const [targetId, message] of snapshot.targetErrors) {
      await tx.update(upstreamTargets).set({
        configurationStatus: 'error',
        lastConfigurationSyncAt: now,
        lastError: message,
        updatedAt: now
      }).where(eq(upstreamTargets.id, targetId))
    }
  })
  upstreamServiceTokenService.invalidate(context.service.id)
}

async function performPlatformServiceDiscovery(upstreamServiceId: string) {
  const context = await loadServiceControlContext(upstreamServiceId)
  if (!context.targets.some(target => target.enabled)) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service has no enabled targets',
      data: { code: 'SERVICE_HAS_NO_TARGETS' }
    })
  }
  const token = await upstreamServiceTokenService.getForControl(upstreamServiceId)
  if (!token) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service Token is not configured',
      data: { code: 'SERVICE_TOKEN_REQUIRED' }
    })
  }

  const snapshot = await fetchServiceSnapshot(context, token)
  if (!snapshot.ok) {
    await recordDiscoveryFailure(context, snapshot)
    throw snapshot.error
  }
  try {
    await commitServiceSnapshot(context, snapshot)
  } catch (error) {
    await recordDiscoveryFailure(context, {
      ok: false,
      error,
      targetErrors: new Map()
    })
    throw error
  }

  const refreshed = await loadServiceControlContext(upstreamServiceId)
  const published = hasReadyServiceTarget(
    refreshed.targets,
    refreshed.connection
  )
    ? (await applyPlatformRevision(null)).revision
    : null
  return {
    ...await buildServiceControlView(
      refreshed,
      { checkAvailability: true }
    ),
    // Distinct from connection.configurationRevision: this is the routing
    // snapshot sequence published by this discovery.
    routingRevision: published
  }
}

async function runPlatformServiceDiscovery(upstreamServiceId: string) {
  try {
    return await performPlatformServiceDiscovery(upstreamServiceId)
  } finally {
    activeDiscoveries.delete(upstreamServiceId)
  }
}

export function discoverPlatformService(upstreamServiceId: string) {
  const active = activeDiscoveries.get(upstreamServiceId)
  if (active) return active

  const discovery = runPlatformServiceDiscovery(upstreamServiceId)
  activeDiscoveries.set(upstreamServiceId, discovery)
  return discovery
}
