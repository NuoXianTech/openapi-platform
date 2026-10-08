import { and, eq } from 'drizzle-orm'
import type {
  ServiceAvailability,
  ServiceConfigurationView,
  ServiceTargetAvailability,
  ServiceConnectionView,
  ServiceTargetControlState
} from '#shared/types/service-control'
import { db, type DatabaseTransaction } from '~~/server/db/client'
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
  publicStoredServiceConfiguration
} from '~~/server/utils/service-configuration-values'
import { toNullableIsoString } from '~~/server/utils/date'
import { firstRow } from '~~/server/utils/row'

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

export async function buildServiceControlView(
  context: PlatformServiceControlContext,
  options: ServiceViewOptions & { transaction?: DatabaseTransaction } = {}
): Promise<ServiceConfigurationView> {
  const executor = options.transaction ?? db
  const document = context.service.openapiDocumentId
    ? firstRow(await executor.select({
        summary: openapiDocuments.parsedSummary
      }).from(openapiDocuments)
        .where(eq(
          openapiDocuments.id,
          context.service.openapiDocumentId
        ))
        .limit(1))
    : null
  const view: ServiceConfigurationView = {
    connection: toServiceConnectionView(context.connection),
    definition: context.connection.configurationSchema ?? null,
    values: publicStoredServiceConfiguration(
      context.connection.configurationSchema ?? null,
      context.connection.configurationValues
    ),
    targets: context.targets.map(target => serviceTargetControlState(target, 'unknown')),
    endpoints: document ? readStoredServiceEndpoints(document.summary) : []
  }
  return options.checkAvailability === true
    ? refreshServiceControlAvailability(context, view)
    : view
}

/** One best-effort observation policy for lists, details and committed writes.
 * The credential belongs to this context; probing never performs another read. */
export async function resolveServiceControlAvailability(context: PlatformServiceControlContext) {
  const unknown = {
    overall: 'unknown' as const,
    targets: new Map(context.targets.map(target => [target.id, 'unknown' as const]))
  }
  if (context.service.status !== 'active'
    || !context.connection.serviceDescription
    || !context.targets.some(target => target.enabled)) return unknown
  try {
    return await resolveServiceAvailability(
      context.connection.serviceDescription,
      context.targets,
      upstreamServiceTokenService.forControlContext(context.connection)
    )
  } catch {
    // Credential errors can contain secret data; log only the affected identity.
    console.error('[service-control] availability unavailable', { upstreamId: context.service.id })
    return unknown
  }
}

/** Preserve the committed view (including Endpoint audit facts) on probe errors. */
export async function refreshServiceControlAvailability(
  context: PlatformServiceControlContext,
  view: ServiceConfigurationView
): Promise<ServiceConfigurationView> {
  const availability = await resolveServiceControlAvailability(context)
  return {
    ...view,
    connection: { ...view.connection, availability: availability.overall },
    targets: view.targets.map(target => ({
      ...target, availability: availability.targets.get(target.id) ?? 'unknown'
    }))
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
