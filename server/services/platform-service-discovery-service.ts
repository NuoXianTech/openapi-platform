import { createHash } from 'node:crypto'
import type {
  RedactedServiceConfigurationState,
  ServiceConfigurationDefinition,
  ServiceDescription
} from '#shared/types/service-control'
import { createApplicationError } from '~~/server/errors/application-error'
import {
  loadServiceControlContext,
  safeServiceControlError,
  type PlatformServiceControlContext
} from '~~/server/services/platform-service-control-context'
import { serviceControlState, type ServiceDiscoverySnapshot } from '~~/server/services/platform-service-control/state'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'
import { canonicalJson } from '~~/server/utils/canonical-json'
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

interface DiscoveryFetchSuccess extends ServiceDiscoverySnapshot {
  ok: true
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
      definition: first.definition,
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

export async function discoverPlatformService(upstreamServiceId: string) {
  const context = await loadServiceControlContext(upstreamServiceId)
  if (!context.targets.some(target => target.enabled)) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service has no enabled targets',
      data: { code: 'SERVICE_HAS_NO_TARGETS' }
    })
  }
  const token = upstreamServiceTokenService.forControlContext(context.connection)
  if (!token) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service Token is not configured',
      data: { code: 'SERVICE_TOKEN_REQUIRED' }
    })
  }

  const snapshot = await fetchServiceSnapshot(context, token)
  if (!snapshot.ok) {
    await serviceControlState.recordDiscoveryFailure(context, snapshot).catch(() => undefined)
    throw snapshot.error
  }
  try {
    return await serviceControlState.commitDiscovery(context, snapshot)
  } catch (error) {
    await serviceControlState.recordDiscoveryFailure(context, {
      error,
      targetErrors: new Map()
    }).catch(() => undefined)
    throw error
  }
}
