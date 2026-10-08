import { serviceControlState } from '~~/server/services/platform-service-control/state'
import type {
  RedactedServiceConfigurationState,
  ServiceConfigurationSyncResult
} from '#shared/types/service-control'
import { createApplicationError } from '~~/server/errors/application-error'
import {
  type PlatformServiceControlContext,
  loadServiceControlContext,
  safeServiceControlError,
  serviceTargetControlState
} from '~~/server/services/platform-service-control-context'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'
import {
  ServiceControlRequestError,
  serviceControlClient
} from '~~/server/utils/service-control-client'
import {
  prepareServiceConfiguration,
  type PreparedServiceConfiguration,
  ServiceConfigurationValueError
} from '~~/server/utils/service-configuration-values'

// Limit queued Target work per synchronization; the control client owns the shared HTTP budget.
const CONFIGURATION_SYNC_CONCURRENCY = 8
const MAX_CONFIGURATION_REVISION = 2_147_483_647

interface ConfigurationRevisionTarget {
  enabled: boolean
  configurationRevision: number | null
  configurationHash: string | null
}

class ServiceConfigurationRevisionAheadError extends Error {
  constructor(readonly currentRevision: number) {
    super(`Service Target configuration revision is already ${currentRevision}`)
    this.name = 'ServiceConfigurationRevisionAheadError'
  }
}

function serviceConflictRevision(error: unknown): number | null {
  if (
    !(error instanceof ServiceControlRequestError)
    || error.status !== 409
    || error.code !== 'CONFIGURATION_REVISION_CONFLICT'
  ) return null

  const rawRevision = error.responseData?.currentRevision
  const revision = typeof rawRevision === 'number' ? rawRevision : Number.NaN
  return Number.isSafeInteger(revision) && revision >= 0
    ? revision
    : null
}

function incrementConfigurationRevision(revision: number): number {
  if (revision >= MAX_CONFIGURATION_REVISION) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service configuration revision is exhausted',
      data: { code: 'SERVICE_CONFIGURATION_REVISION_EXHAUSTED' }
    })
  }
  return revision + 1
}

function nextServiceConfigurationRevision(
  currentRevision: number,
  targets: readonly ConfigurationRevisionTarget[]
): number {
  const highestRevision = targets
    .filter(target => target.enabled)
    .reduce(
      (highest, target) => Math.max(
        highest,
        target.configurationRevision ?? 0
      ),
      currentRevision
    )
  return incrementConfigurationRevision(highestRevision)
}

function serviceConfigurationSynchronizationRevision(
  currentRevision: number,
  configurationHash: string,
  targets: readonly ConfigurationRevisionTarget[]
): number {
  const enabledTargets = targets.filter(target => target.enabled)
  const mustAdvance = enabledTargets.some(target => (
    (target.configurationRevision ?? 0) > currentRevision
    || (
      target.configurationRevision === currentRevision
      && target.configurationHash !== null
      && target.configurationHash !== configurationHash
    )
  ))
  return mustAdvance
    ? nextServiceConfigurationRevision(currentRevision, enabledTargets)
    : currentRevision
}

async function mapBounded<TItem, TResult>(
  items: readonly TItem[],
  worker: (item: TItem) => Promise<TResult>,
  concurrency: number
): Promise<TResult[]> {
  const results: TResult[] = []
  let nextIndex = 0
  const runWorker = async () => {
    while (true) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index]!)
    }
  }
  await Promise.all(Array.from({
    length: Math.min(Math.max(concurrency, 1), items.length)
  }, runWorker))
  return results
}

async function pushConfiguration(
  context: PlatformServiceControlContext,
  revision: number,
  configuration: PreparedServiceConfiguration,
  recoverRevisionConflict: boolean
): Promise<ServiceConfigurationSyncResult> {
  const description = context.connection.serviceDescription
  const serviceId = context.connection.serviceId
  const schemaSha256 = context.connection.configurationSchemaSha256
  if (!description || !serviceId || !schemaSha256) {
    throw createApplicationError({
      statusCode: 409,
      message: 'discover the Service before synchronizing configuration',
      data: { code: 'SERVICE_NOT_DISCOVERED' }
    })
  }
  const enabledTargets = context.targets.filter(target => target.enabled)
  if (enabledTargets.length === 0) {
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

  const results = await mapBounded(enabledTargets, async (target) => {
    try {
      const response = await serviceControlClient.updateConfiguration(
        target.baseUrl,
        description.configuration.update,
        token,
        { revision, values: configuration.values }
      )
      const state: RedactedServiceConfigurationState = {
        schemaVersion: 1,
        serviceId: response.data.serviceId,
        schemaSha256: response.data.schemaSha256,
        revision: response.data.revision,
        configurationSha256: response.data.configurationSha256,
        values: configuration.publicValues,
        updatedAt: response.data.updatedAt
      }
      return { ok: true as const, targetId: target.id, state }
    } catch (error) {
      return {
        ok: false as const,
        targetId: target.id,
        conflictingRevision: serviceConflictRevision(error),
        error: safeServiceControlError(error)
      }
    }
  }, CONFIGURATION_SYNC_CONCURRENCY)

  const conflictingRevision = results.reduce<number | null>(
    (highest, result) => {
      if (result.ok || result.conflictingRevision === null) return highest
      return Math.max(highest ?? 0, result.conflictingRevision)
    },
    null
  )
  if (
    recoverRevisionConflict
    && conflictingRevision !== null
    && conflictingRevision >= revision
  ) {
    throw new ServiceConfigurationRevisionAheadError(conflictingRevision)
  }

  const accepted = await serviceControlState.acceptConfiguration(context, results)
  return {
    status: accepted.status,
    revision,
    configurationHash: configuration.hash,
    values: configuration.publicValues,
    targets: accepted.targets.map(target => (
      serviceTargetControlState(target, 'unknown')
    ))
  }
}

async function pushConfigurationWithRevisionRecovery(input: {
  context: PlatformServiceControlContext
  revision: number
  configuration: PreparedServiceConfiguration
}): Promise<ServiceConfigurationSyncResult> {
  let context = input.context
  let revision = input.revision
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await pushConfiguration(
        context,
        revision,
        input.configuration,
        attempt === 0
      )
    } catch (error) {
      if (!(error instanceof ServiceConfigurationRevisionAheadError)) throw error

      revision = incrementConfigurationRevision(Math.max(
        revision,
        error.currentRevision
      ))
      context = await serviceControlState.saveConfiguration(context, { revision })
    }
  }
  throw new Error('Service configuration revision recovery exhausted')
}

export async function updatePlatformServiceConfiguration(
  upstreamServiceId: string,
  input: {
    expectedRevision: number
    values: Record<string, unknown>
    secrets: Record<string, string | null>
  }
): Promise<ServiceConfigurationSyncResult> {
  const context = await loadServiceControlContext(upstreamServiceId)
  const definition = context.connection.configurationSchema
  const schemaSha256 = context.connection.configurationSchemaSha256
  if (!definition || !schemaSha256) {
    throw createApplicationError({
      statusCode: 409,
      message: 'discover the Service before editing configuration',
      data: { code: 'SERVICE_NOT_DISCOVERED' }
    })
  }
  if (context.connection.configurationRevision !== input.expectedRevision) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service configuration was changed by another administrator',
      data: {
        code: 'SERVICE_CONFIGURATION_REVISION_CONFLICT',
        currentRevision: context.connection.configurationRevision
      }
    })
  }

  let configuration: PreparedServiceConfiguration
  try {
    configuration = prepareServiceConfiguration({
      definition,
      schemaSha256,
      stored: context.connection.configurationValues,
      valueUpdates: input.values,
      secretUpdates: input.secrets
    })
  } catch (error) {
    if (error instanceof ServiceConfigurationValueError) {
      throw createApplicationError({
        statusCode: 400,
        message: error.message,
        data: { code: 'SERVICE_CONFIGURATION_INVALID', field: error.field }
      })
    }
    throw error
  }
  const revision = nextServiceConfigurationRevision(
    context.connection.configurationRevision,
    context.targets
  )
  const updated = await serviceControlState.saveConfiguration(context, {
    revision,
    configuration: { values: configuration.toStoredValues(), hash: configuration.hash }
  })
  const result = await pushConfigurationWithRevisionRecovery({
    context: updated,
    revision,
    configuration
  })
  return result
}

export async function synchronizePlatformServiceConfiguration(
  upstreamServiceId: string
): Promise<ServiceConfigurationSyncResult> {
  const context = await loadServiceControlContext(upstreamServiceId)
  const definition = context.connection.configurationSchema
  const schemaSha256 = context.connection.configurationSchemaSha256
  if (
    !definition
    || !schemaSha256
    || context.connection.configurationRevision < 1
    || !context.connection.configurationHash
  ) {
    throw createApplicationError({
      statusCode: 409,
      message: 'save a Service configuration before synchronizing it',
      data: { code: 'SERVICE_CONFIGURATION_NOT_SAVED' }
    })
  }
  const configuration = prepareServiceConfiguration({
    definition,
    schemaSha256,
    stored: context.connection.configurationValues,
    valueUpdates: {},
    secretUpdates: {}
  })
  if (configuration.hash !== context.connection.configurationHash) {
    throw createApplicationError({
      statusCode: 500,
      message: 'stored Service configuration fingerprint is invalid',
      data: { code: 'SERVICE_CONFIGURATION_STORAGE_INVALID' }
    })
  }
  const revision = serviceConfigurationSynchronizationRevision(
    context.connection.configurationRevision,
    configuration.hash,
    context.targets
  )
  const synchronizedContext = revision === context.connection.configurationRevision
    ? context
    : await serviceControlState.saveConfiguration(context, { revision })
  const result = await pushConfigurationWithRevisionRecovery({
    context: synchronizedContext,
    revision,
    configuration
  })
  return result
}
