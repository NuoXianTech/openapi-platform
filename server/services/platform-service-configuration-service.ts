import { and, eq } from 'drizzle-orm'
import type {
  RedactedServiceConfigurationState,
  RoutingRevisionRef,
  ServiceConfigurationDefinition,
  ServiceConfigurationSyncOutcome,
  ServiceConfigurationSyncResult,
  ServiceConfigurationValue,
  StoredServiceConfigurationValues
} from '#shared/types/service-control'
import {
  upstreamServiceConnections,
  upstreamTargets
} from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import {
  type PlatformServiceControlContext,
  loadServiceControlContext,
  commitServiceControlContext,
  safeServiceControlError,
  serviceTargetControlState
} from '~~/server/services/platform-service-control-context'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'
import {
  ServiceControlRequestError,
  serviceControlClient
} from '~~/server/utils/service-control-client'
import {
  calculateServiceConfigurationHash,
  defaultServiceConfigurationValues,
  normalizeServiceConfigurationValues,
  serviceConfigurationFields,
  ServiceConfigurationValueError
} from '~~/server/utils/service-configuration-values'
import {
  decryptStoredSecret,
  encryptStoredSecret
} from '~~/server/utils/stored-secret'
import { refreshPlatformRevision } from '~~/server/services/platform-endpoint-publication-service'

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

export function nextServiceConfigurationRevision(
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

export function serviceConfigurationSynchronizationRevision(
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

function redactedStateFromValues(input: {
  serviceId: string
  schemaSha256: string
  revision: number
  configurationSha256: string
  values: Record<string, ServiceConfigurationValue>
  definition: ServiceConfigurationDefinition
  updatedAt: string
}): RedactedServiceConfigurationState {
  const fields = new Map(
    serviceConfigurationFields(input.definition)
      .map(field => [field.key, field])
  )
  return {
    schemaVersion: 1,
    serviceId: input.serviceId,
    schemaSha256: input.schemaSha256,
    revision: input.revision,
    configurationSha256: input.configurationSha256,
    values: Object.fromEntries(Object.entries(input.values).map(
      ([key, value]) => [
        key,
        fields.get(key)?.type === 'secret'
          ? { configured: typeof value === 'string' && value.length > 0 }
          : value
      ]
    )),
    updatedAt: input.updatedAt
  }
}

async function pushConfiguration(
  context: PlatformServiceControlContext,
  revision: number,
  values: Record<string, ServiceConfigurationValue>,
  configurationHash: string,
  recoverRevisionConflict: boolean
): Promise<ServiceConfigurationSyncResult> {
  const definition = context.connection.configurationSchema
  const description = context.connection.serviceDescription
  const serviceId = context.connection.serviceId
  const schemaSha256 = context.connection.configurationSchemaSha256
  if (!definition || !description || !serviceId || !schemaSha256) {
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
  const token = await upstreamServiceTokenService.getForControl(context.service.id)
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
        { revision, values }
      )
      const matches = response.data.serviceId === serviceId
        && response.data.schemaSha256 === schemaSha256
        && response.data.revision === revision
        && response.data.configurationSha256 === configurationHash
      const state = redactedStateFromValues({
        serviceId: response.data.serviceId,
        schemaSha256: response.data.schemaSha256,
        revision: response.data.revision,
        configurationSha256: response.data.configurationSha256,
        values,
        definition,
        updatedAt: response.data.updatedAt
      })
      return { ok: true as const, targetId: target.id, matches, state }
    } catch (error) {
      return {
        ok: false as const,
        targetId: target.id,
        matches: false as const,
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

  const successful = results.filter(result => result.ok && result.matches).length
  const status = successful === enabledTargets.length
    ? 'synced'
    : successful > 0 ? 'partial' : 'failed'
  await commitServiceControlContext(context, 'configuration', async (tx, _current, synchronizedAt) => {
    for (const result of results) {
      if (result.ok) {
        await tx.update(upstreamTargets).set({
          configurationRevision: result.state.revision,
          configurationHash: result.state.configurationSha256,
          configurationStatus: result.matches ? 'synced' : 'drifted',
          configurationState: result.state,
          lastConfigurationSyncAt: synchronizedAt,
          lastError: result.matches
            ? null
            : 'Service configuration ACK mismatch',
          updatedAt: synchronizedAt
        }).where(eq(upstreamTargets.id, result.targetId))
      } else {
        await tx.update(upstreamTargets).set({
          configurationStatus: 'error',
          lastConfigurationSyncAt: synchronizedAt,
          lastError: result.error,
          updatedAt: synchronizedAt
        }).where(eq(upstreamTargets.id, result.targetId))
      }
    }

    if (status === 'synced') {
      await tx.update(upstreamServiceConnections).set({
        lastConfigurationSyncAt: synchronizedAt,
        updatedAt: synchronizedAt
      }).where(eq(
        upstreamServiceConnections.upstreamServiceId,
        context.service.id
      ))
    }
  })
  const refreshed = await loadServiceControlContext(context.service.id)
  return {
    status,
    revision,
    configurationHash,
    targets: refreshed.targets.map(target => (
      serviceTargetControlState(target, 'unknown')
    ))
  }
}

async function publishRoutableConfigurationTargets(
  result: ServiceConfigurationSyncResult
): Promise<{ routingRevision: RoutingRevisionRef | null }> {
  // A partial sync still changes the safe Target set: synchronized Targets can
  // serve the new configuration while failed or drifted Targets must be
  // removed from the next immutable runtime snapshot.
  if (result.status === 'failed') {
    return { routingRevision: null }
  }
  // Named apart from result.revision: that one is the Service configuration
  // revision, this one is the routing snapshot sequence. Spreading both
  // under one key silently dropped the configuration revision.
  const { revision } = await refreshPlatformRevision(null)
  return { routingRevision: revision }
}

function reconstructConfiguration(input: {
  definition: ServiceConfigurationDefinition
  stored: StoredServiceConfigurationValues
  valueUpdates: Record<string, unknown>
  secretUpdates: Record<string, string | null>
}) {
  const fields = serviceConfigurationFields(input.definition)
  const fieldMap = new Map(fields.map(field => [field.key, field]))
  const unknownValue = Object.keys(input.valueUpdates)
    .find(key => fieldMap.get(key)?.type === 'secret' || !fieldMap.has(key))
  if (unknownValue) {
    throw new ServiceConfigurationValueError(
      unknownValue,
      `invalid non-secret configuration field: ${unknownValue}`
    )
  }
  const unknownSecret = Object.keys(input.secretUpdates)
    .find(key => fieldMap.get(key)?.type !== 'secret')
  if (unknownSecret) {
    throw new ServiceConfigurationValueError(
      unknownSecret,
      `invalid secret configuration field: ${unknownSecret}`
    )
  }

  const defaults = defaultServiceConfigurationValues(input.definition)
  const candidate: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.type === 'secret') {
      if (Object.hasOwn(input.secretUpdates, field.key)) {
        candidate[field.key] = input.secretUpdates[field.key] ?? ''
      } else {
        const ciphertext = input.stored.secrets[field.key]
        candidate[field.key] = ciphertext
          ? decryptStoredSecret(ciphertext, 'service-configuration')
          : ''
      }
      continue
    }
    candidate[field.key] = Object.hasOwn(input.valueUpdates, field.key)
      ? input.valueUpdates[field.key]
      : input.stored.values[field.key] ?? defaults[field.key]
  }
  return normalizeServiceConfigurationValues(
    input.definition,
    candidate,
    defaults
  )
}

function storeConfigurationValues(
  definition: ServiceConfigurationDefinition,
  values: Record<string, ServiceConfigurationValue>
): StoredServiceConfigurationValues {
  const stored: StoredServiceConfigurationValues = {
    values: {},
    secrets: {}
  }
  for (const field of serviceConfigurationFields(definition)) {
    const value = values[field.key]
    if (field.type === 'secret') {
      if (typeof value === 'string' && value.length > 0) {
        stored.secrets[field.key] = encryptStoredSecret(
          value,
          'service-configuration'
        )
      }
    } else if (value !== undefined) {
      stored.values[field.key] = value
    }
  }
  return stored
}

async function advanceStoredConfigurationRevision(input: {
  context: PlatformServiceControlContext
  revision: number
}): Promise<PlatformServiceControlContext> {
  return commitServiceControlContext(input.context, 'configuration', async (tx, _current, now) => {
    await tx.update(upstreamServiceConnections)
      .set({ configurationRevision: input.revision, updatedAt: now })
      .where(eq(upstreamServiceConnections.upstreamServiceId, input.context.service.id))
    await tx.update(upstreamTargets).set({
      configurationStatus: 'unknown',
      updatedAt: now
    }).where(and(
      eq(upstreamTargets.upstreamServiceId, input.context.service.id),
      eq(upstreamTargets.enabled, true)
    ))
    return loadServiceControlContext(input.context.service.id, { transaction: tx })
  })
}

async function pushConfigurationWithRevisionRecovery(input: {
  context: PlatformServiceControlContext
  revision: number
  values: Record<string, ServiceConfigurationValue>
  configurationHash: string
}): Promise<ServiceConfigurationSyncResult> {
  let context = input.context
  let revision = input.revision
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await pushConfiguration(
        context,
        revision,
        input.values,
        input.configurationHash,
        attempt === 0
      )
    } catch (error) {
      if (!(error instanceof ServiceConfigurationRevisionAheadError)) throw error

      revision = incrementConfigurationRevision(Math.max(
        revision,
        error.currentRevision
      ))
      context = await advanceStoredConfigurationRevision({
        context,
        revision
      })
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
): Promise<ServiceConfigurationSyncOutcome> {
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

  let values: Record<string, ServiceConfigurationValue>
  try {
    values = reconstructConfiguration({
      definition,
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
  const configurationHash = calculateServiceConfigurationHash(
    schemaSha256,
    values
  )
  const stored = storeConfigurationValues(definition, values)
  const updated = await commitServiceControlContext(context, 'configuration', async (tx, _current, now) => {
    await tx.update(upstreamServiceConnections).set({
      configurationValues: stored,
      configurationRevision: revision,
      configurationHash,
      updatedAt: now
    }).where(eq(upstreamServiceConnections.upstreamServiceId, upstreamServiceId))
    await tx.update(upstreamTargets).set({
      configurationStatus: 'unknown',
      updatedAt: now
    }).where(and(
      eq(upstreamTargets.upstreamServiceId, upstreamServiceId),
      eq(upstreamTargets.enabled, true)
    ))
    return loadServiceControlContext(upstreamServiceId, { transaction: tx })
  })
  const result = await pushConfigurationWithRevisionRecovery({
    context: updated,
    revision,
    values,
    configurationHash
  })
  const publication = await publishRoutableConfigurationTargets(result)
  return { ...result, ...publication }
}

export async function synchronizePlatformServiceConfiguration(
  upstreamServiceId: string
): Promise<ServiceConfigurationSyncOutcome> {
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
  const values = reconstructConfiguration({
    definition,
    stored: context.connection.configurationValues,
    valueUpdates: {},
    secretUpdates: {}
  })
  const configurationHash = calculateServiceConfigurationHash(
    schemaSha256,
    values
  )
  if (configurationHash !== context.connection.configurationHash) {
    throw createApplicationError({
      statusCode: 500,
      message: 'stored Service configuration fingerprint is invalid',
      data: { code: 'SERVICE_CONFIGURATION_STORAGE_INVALID' }
    })
  }
  const revision = serviceConfigurationSynchronizationRevision(
    context.connection.configurationRevision,
    configurationHash,
    context.targets
  )
  const synchronizedContext = revision === context.connection.configurationRevision
    ? context
    : await advanceStoredConfigurationRevision({
        context,
        revision
      })
  const result = await pushConfigurationWithRevisionRecovery({
    context: synchronizedContext,
    revision,
    values,
    configurationHash
  })
  const publication = await publishRoutableConfigurationTargets(result)
  return { ...result, ...publication }
}
