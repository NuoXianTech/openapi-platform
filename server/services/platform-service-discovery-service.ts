import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type {
  RedactedServiceConfigurationState,
  ServiceConfigurationDefinition,
  ServiceDescription
} from '#shared/types/service-control'
import {
  upstreamServiceConnections
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import {
  loadServiceControlContext,
  acceptServiceTargetResults,
  commitServiceControlContext,
  writeServiceTargetResults,
  buildServiceControlView,
  safeServiceControlError,
  type PlatformServiceControlContext
} from '~~/server/services/platform-service-control-context'
import {
  persistServiceOpenApi,
  readStoredServiceEndpoints
} from '~~/server/services/platform-service-openapi-service'
import { platformEndpointService } from '~~/server/services/platform-endpoint-service'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { firstRow } from '~~/server/utils/row'
import {
  UnsupportedServiceProtocolError,
  serviceControlClient
} from '~~/server/utils/service-control-client'
import { readServiceTargetContract } from '~~/server/services/service-target-contract'

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

async function fetchServiceSnapshot(
  context: PlatformServiceControlContext,
  token: string
): Promise<DiscoveryFetchResult> {
  const enabledTargets = context.targets.filter(target => target.enabled)
  const targetResults = await allSettledBounded(
    enabledTargets,
    async (target): Promise<DiscoveredTarget> => {
      return { targetId: target.id, ...await readServiceTargetContract(target.baseUrl, token) }
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
  await acceptServiceTargetResults(context, 'discovery',
    [...failure.targetErrors].map(([targetId, error]) => ({ ok: false, targetId, error })),
    async (tx, current, now) => {
      await tx.update(upstreamServiceConnections).set({
        lastDiscoveryError: safeServiceControlError(failure.error),
        updatedAt: now
      }).where(eq(
        upstreamServiceConnections.upstreamServiceId,
        context.service.id
      ))
      return current.connection
    }).catch(() => undefined)
}

async function commitServiceSnapshot(
  context: PlatformServiceControlContext,
  snapshot: DiscoveryFetchSuccess
) {
  return commitServiceControlContext(context, 'discovery', async (tx, current, changedAt) => {
    await writeServiceTargetResults(tx, current, changedAt, 'discovery', [
      ...snapshot.targets.map(item => ({ ok: true as const, targetId: item.targetId, state: item.state })),
      ...[...snapshot.targetErrors].map(([targetId, error]) => ({ ok: false as const, targetId, error }))
    ], async (tx, current, now) => {
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

      return upstreamServiceTokenService.promoteVerified(tx, updatedConnection)
    })
    // Read and decode the response while rollback is still possible. No fresh
    // context or OpenAPI read is required after this transaction commits.
    const committed = await loadServiceControlContext(context.service.id, { transaction: tx })
    const view = await buildServiceControlView(committed, { transaction: tx })
    return { context: committed, view }
  })
}

export async function discoverPlatformService(upstreamServiceId: string) {
  const context = await loadServiceControlContext(upstreamServiceId)
  if (!context.targets.some(target => target.enabled)) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service has no enabled targets',
      data: { code: 'SERVICE_HAS_NO_TARGETS' }
    })
  }
  const token = upstreamServiceTokenService.forVerification(context.connection)
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
    return await commitServiceSnapshot(context, snapshot)
  } catch (error) {
    await recordDiscoveryFailure(context, {
      ok: false,
      error,
      targetErrors: new Map()
    })
    throw error
  }
}
