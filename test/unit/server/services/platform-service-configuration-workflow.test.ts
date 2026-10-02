import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import type { H3Event } from 'h3'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceDescription } from '#shared/types/service-control'
import * as schema from '~~/server/db/schema'
import { calculateServiceConfigurationHash } from '~~/server/utils/service-configuration-values'
import { canonicalJson } from '~~/server/utils/canonical-json'
import * as availability from '~~/server/services/service-availability-service'
import { isServiceTargetReady } from '~~/server/utils/service-upstream-readiness'

const context = vi.hoisted(() => ({ database: null as unknown, upstreamId: '', audit: vi.fn() }))
vi.mock('~~/server/utils/auth', () => ({ defineAdminEventHandler: (handler: (event: H3Event, admin: { id: number, username: string }) => Promise<unknown>) => (event: H3Event) => handler(event, { id: 1, username: 'admin' }) }))
vi.mock('~~/server/utils/router-param', () => ({ readUuidRouterParam: () => context.upstreamId }))
vi.mock('~~/server/utils/request-operation-log', () => ({ addRequestOperationLog: context.audit }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
vi.mock('~~/server/services/routing-revision-service', async (original) => ({
  ...await original<typeof import('~~/server/services/routing-revision-service')>(),
  refreshPlatformRevision: vi.fn(async () => ({ revision: { id: 'published', sequence: 1 } }))
}))
const { platformUpstreamService } = await import('~~/server/services/platform-upstream-service')
const { platformServiceControlService } = await import('~~/server/services/platform-service-control-service')
const { synchronizeConfiguration: synchronizePlatformServiceConfiguration, updateConfiguration: updatePlatformServiceConfiguration, discover: discoverPlatformService } = platformServiceControlService
const { serviceControlClient } = await import('~~/server/utils/service-control-client')
const { refreshPlatformRevision } = await import('~~/server/services/routing-revision-service')
const { acceptServiceTargetResults, loadServiceControlContext } = await import('~~/server/services/platform-service-control-context')
const { default: discoverHandler } = await import('~~/server/api/admin/v1/upstreams/[id]/discover.post')
let client: PGlite
let database: ReturnType<typeof drizzle<typeof schema>>
const schemaHash = 'a'.repeat(64)
const hash = calculateServiceConfigurationHash(schemaHash, {})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

beforeAll(async () => {
  client = new PGlite()
  database = drizzle(client, { schema })
  context.database = database
  await migrate(database, { migrationsFolder: resolve('server/db/migrations/postgresql'), migrationsSchema: 'drizzle', migrationsTable: '__drizzle_migrations' })
})
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('useRuntimeConfig', () => ({ apiKeySecret: '0123456789abcdef0123456789abcdef' }))
  await client.exec('TRUNCATE TABLE platform_runtime, routing_revisions, api_products, upstream_services CASCADE;')
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
afterAll(async () => client.close())

async function configuredUpstream() {
  const upstream = await platformUpstreamService.create({
    slug: 'configuration-workflow', name: 'Configuration workflow',
    serviceToken: 'configuration-test-token-with-at-least-32-characters',
    loadBalancing: 'round_robin', targets: [{ baseUrl: 'http://127.0.0.1:8080', weight: 1 }]
  })
  const description: ServiceDescription = {
    schemaVersion: 1, serviceProtocol: 'openapi-service/v1', serviceId: 'workflow', name: 'Workflow', version: '1', commit: 'test',
    openapi: '/openapi.json', openapiSha256: 'b'.repeat(64), health: '/healthz', readiness: '/readyz',
    configuration: { schema: '/schema', state: '/config', update: '/config', schemaSha256: schemaHash }
  }
  await database.update(schema.upstreamServiceConnections).set({
    serviceId: 'workflow', serviceDescription: description, configurationSchema: { schemaVersion: 1, groups: [] },
    configurationSchemaSha256: schemaHash, configurationRevision: 1, configurationHash: hash,
    configurationValues: { values: {}, secrets: {} }
  }).where(eq(schema.upstreamServiceConnections.upstreamServiceId, upstream.id))
  return upstream
}

function response(revision = 1): Awaited<ReturnType<typeof serviceControlClient.updateConfiguration>> {
  return {
    data: { schemaVersion: 1, serviceId: 'workflow', schemaSha256: schemaHash, revision, configurationSha256: hash, values: {}, updatedAt: new Date().toISOString() },
    headers: new Headers(), url: 'http://127.0.0.1:8080/config'
  }
}

describe('configuration result acceptance', () => {
  it('preserves discovered contract and verified Token when publication fails, then retries through the control interface', async () => {
    const upstream = await configuredUpstream()
    const original = await loadServiceControlContext(upstream.id)
    const definition = { schemaVersion: 1 as const, groups: [] }
    const document = { openapi: '3.1.0', info: { title: 'Workflow', version: '2' }, paths: {} }
    const fingerprint = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')
    const description = { ...original.connection.serviceDescription!, version: '2', openapiSha256: fingerprint(document),
      configuration: { ...original.connection.serviceDescription!.configuration, schemaSha256: fingerprint(definition) } }
    const state = { ...response().data, schemaSha256: fingerprint(definition) }
    await platformUpstreamService.updateServiceToken(upstream.id, 'replacement-service-token-with-at-least-32-characters')
    const getDescription = vi.spyOn(serviceControlClient, 'getDescription').mockResolvedValue({
      data: description, headers: new Headers({ 'x-openapi-sha256': description.openapiSha256 }), url: 'http://127.0.0.1:8080/description'
    })
    vi.spyOn(serviceControlClient, 'getConfigurationDefinition').mockResolvedValue({
      data: definition, headers: new Headers({ 'x-configuration-schema-sha256': fingerprint(definition) }), url: 'http://127.0.0.1:8080/schema'
    })
    vi.spyOn(serviceControlClient, 'getConfigurationState').mockResolvedValue({ data: state, headers: new Headers(), url: 'http://127.0.0.1:8080/config' })
    vi.spyOn(serviceControlClient, 'getOpenAPI').mockResolvedValue({ data: document, headers: new Headers({ 'x-openapi-sha256': description.openapiSha256 }), url: 'http://127.0.0.1:8080/openapi.json' })
    vi.spyOn(availability, 'resolveServiceAvailability').mockResolvedValue({ overall: 'online', targets: new Map() })
    vi.mocked(refreshPlatformRevision).mockRejectedValueOnce(new Error('publication unavailable'))
    const first = discoverPlatformService(upstream.id)
    expect(discoverPlatformService(upstream.id)).toBe(first)
    context.upstreamId = upstream.id
    const audited = discoverHandler({} as H3Event)
    const result = await first
    expect(await audited).toEqual(result)
    expect(context.audit).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({
      action: 'admin.platform.service.discover', resourceId: upstream.id,
      detail: expect.objectContaining({ routingStatus: 'pending', routingRevision: null, openapiSha256: description.openapiSha256 })
    }))
    expect(result).toMatchObject({ routingStatus: 'pending', routingRevision: null,
      connection: { serviceVersion: '2', openapiSha256: description.openapiSha256, lastDiscoveryError: null } })
    const saved = await loadServiceControlContext(upstream.id)
    expect(saved.connection.pendingServiceTokenCiphertext).toBeNull()
    expect(saved.connection.serviceTokenCiphertext).not.toBe(original.connection.serviceTokenCiphertext)
    expect(saved.service.openapiDocumentId).toBeTruthy()
    expect(getDescription).toHaveBeenCalledOnce()
    const retry = await discoverPlatformService(upstream.id)
    expect(retry.routingStatus).toBe('applied')
    expect((await loadServiceControlContext(upstream.id)).service.openapiDocumentId).toBe(saved.service.openapiDocumentId)
    expect(getDescription).toHaveBeenCalledTimes(2)
  })

  it('returns normalized saved values without exposing secret plaintext', async () => {
    const upstream = await configuredUpstream()
    await database.update(schema.upstreamServiceConnections).set({
      configurationSchema: { schemaVersion: 1, groups: [{ key: 'credentials', label: 'Credentials', fields: [
        { key: 'secret', type: 'secret', label: 'Secret' },
        { key: 'enabled', type: 'boolean', label: 'Enabled', default: true }
      ] }] }
    }).where(eq(schema.upstreamServiceConnections.upstreamServiceId, upstream.id))
    vi.spyOn(serviceControlClient, 'updateConfiguration').mockImplementation(async (_url, _endpoint, _token, input) => ({
      ...response(input.revision), data: { ...response(input.revision).data,
        configurationSha256: calculateServiceConfigurationHash(schemaHash, input.values) }
    }))
    const result = await updatePlatformServiceConfiguration(upstream.id, {
      expectedRevision: 1, values: { enabled: false }, secrets: { secret: 'must-not-leak' }
    })
    expect(result).toMatchObject({ status: 'synced', values: { enabled: false, secret: { configured: true } } })
    expect(JSON.stringify(result)).not.toContain('must-not-leak')
  })

  it('preserves saved configuration on publication failure and retries without advancing its revision', async () => {
    const upstream = await configuredUpstream()
    const update = vi.spyOn(serviceControlClient, 'updateConfiguration').mockResolvedValue(response(2))
    vi.mocked(refreshPlatformRevision).mockRejectedValueOnce(new Error('publication unavailable'))
    const result = await updatePlatformServiceConfiguration(upstream.id, { expectedRevision: 1, values: {}, secrets: {} })
    expect(result).toMatchObject({ status: 'synced', revision: 2, routingRevision: null, routingStatus: 'pending', values: {} })
    expect(result.targets[0]).toMatchObject({ configurationRevision: 2, configurationStatus: 'synced' })
    expect((await loadServiceControlContext(upstream.id)).connection.configurationRevision).toBe(2)
    const retried = await synchronizePlatformServiceConfiguration(upstream.id)
    expect(retried).toMatchObject({ revision: 2, routingStatus: 'applied', routingRevision: { id: 'published' } })
    expect(update.mock.calls.map(call => call[3].revision)).toEqual([2, 2])
  })

  it.each(['discovery', 'configuration'] as const)('accepts mixed %s observations with one timestamp and preserves failed Target facts', async (operation) => {
    const upstream = await configuredUpstream()
    const { target: drifted } = await platformUpstreamService.createTarget(upstream.id, { baseUrl: 'http://127.0.0.1:9090', weight: 1, enabled: true })
    const { target: failed } = await platformUpstreamService.createTarget(upstream.id, { baseUrl: 'http://127.0.0.1:9091', weight: 1, enabled: true })
    await database.update(schema.upstreamTargets).set({
      configurationRevision: 1, configurationHash: hash, configurationState: response().data
    }).where(eq(schema.upstreamTargets.id, failed.id))
    const expected = await loadServiceControlContext(upstream.id)
    const lastChange = Math.max(expected.connection.updatedAt.getTime(), ...expected.targets.map(target => target.updatedAt.getTime()))
    const status = await acceptServiceTargetResults(expected, operation, [
      { ok: true, targetId: upstream.targets[0]!.id, state: response().data },
      { ok: true, targetId: drifted.id, state: { ...response().data, configurationSha256: 'c'.repeat(64) } },
      { ok: false, targetId: failed.id, error: 'offline' }
    ])
    expect(status.status).toBe('partial')
    const current = await loadServiceControlContext(upstream.id)
    const byId = new Map(current.targets.map(target => [target.id, target]))
    expect(byId.get(upstream.targets[0]!.id)).toMatchObject({ configurationStatus: 'synced', lastError: null })
    expect(byId.get(drifted.id)).toMatchObject({
      configurationStatus: 'drifted', lastError: operation === 'configuration' ? 'Service configuration ACK mismatch' : null
    })
    expect(byId.get(failed.id)).toMatchObject({
      configurationStatus: 'error', lastError: 'offline', configurationRevision: 1, configurationHash: hash,
      configurationState: { serviceId: 'workflow' }
    })
    expect(new Set(current.targets.map(target => target.updatedAt.getTime())).size).toBe(1)
    expect(current.targets[0]!.updatedAt.getTime()).toBeGreaterThan(lastChange)
    expect(current.connection.lastConfigurationSyncAt).toEqual(expected.connection.lastConfigurationSyncAt)
  })

  it('classifies discovery against the contract committed in the same acceptance transaction', async () => {
    const upstream = await configuredUpstream()
    const expected = await loadServiceControlContext(upstream.id)
    await acceptServiceTargetResults(expected, 'discovery', [
      { ok: true, targetId: upstream.targets[0]!.id, state: response().data }
    ], async (tx, current, changedAt) => {
      const [connection] = await tx.update(schema.upstreamServiceConnections).set({
        configurationHash: null, updatedAt: changedAt
      }).where(eq(schema.upstreamServiceConnections.upstreamServiceId, current.service.id)).returning()
      return connection!
    })
    const current = await loadServiceControlContext(upstream.id)
    expect(current.targets[0]).toMatchObject({ configurationStatus: 'unknown', lastError: null })
    expect(isServiceTargetReady(current.targets[0]!, current.connection)).toBe(true)
  })

  it.each(['foreign', 'duplicate'] as const)('rejects %s observations before any accepted write', async (kind) => {
    const upstream = await configuredUpstream()
    const expected = await loadServiceControlContext(upstream.id)
    const targetId = kind === 'foreign' ? 'unknown-target' : upstream.targets[0]!.id
    const observation = { ok: true as const, targetId, state: response().data }
    const update = vi.fn(async () => expected.connection)
    await expect(acceptServiceTargetResults(expected, 'discovery',
      kind === 'duplicate' ? [observation, observation] : [observation], update
    )).rejects.toThrow('Target observation')
    expect(update).not.toHaveBeenCalled()
    expect(await loadServiceControlContext(upstream.id)).toEqual(expected)
  })

  it.each([false, true])('only records discovery failure in its original context (changed=%s)', async (changed) => {
    const upstream = await configuredUpstream()
    const started = deferred<undefined>()
    const resume = deferred<undefined>()
    vi.spyOn(serviceControlClient, 'getDescription').mockImplementation(async () => {
      started.resolve(undefined)
      await resume.promise
      throw new Error('offline')
    })
    const pending = discoverPlatformService(upstream.id)
    const rejected = expect(pending).rejects.toMatchObject({ data: { code: 'SERVICE_DISCOVERY_FAILED' } })
    await started.promise
    if (changed) await platformUpstreamService.updateTarget(upstream.targets[0]!.id, { baseUrl: 'http://127.0.0.1:9090' })
    resume.resolve(undefined)
    await rejected
    const [target] = await database.select().from(schema.upstreamTargets).where(eq(schema.upstreamTargets.id, upstream.targets[0]!.id))
    expect(target!.configurationStatus).toBe(changed ? 'unknown' : 'error')
    expect(target!.lastError).toBe(changed ? null : 'offline')
  })

  it.each(['address', 'reenable', 'token', 'configuration', 'membership'] as const)('rejects late ACKs after %s changes', async (change) => {
    const upstream = await configuredUpstream()
    const target = upstream.targets[0]!
    const ack = deferred<ReturnType<typeof response>>()
    const started = deferred<undefined>()
    vi.spyOn(serviceControlClient, 'updateConfiguration').mockImplementation(() => { started.resolve(undefined); return ack.promise })
    const pending = synchronizePlatformServiceConfiguration(upstream.id)
    const rejected = expect(pending).rejects.toMatchObject({ data: { code: 'SERVICE_CONFIGURATION_REVISION_CONFLICT' } })
    await started.promise
    if (change === 'address') await platformUpstreamService.updateTarget(target.id, { baseUrl: 'http://127.0.0.1:9090' })
    if (change === 'reenable') {
      vi.spyOn(Date, 'now').mockReturnValue(0)
      await platformUpstreamService.updateTarget(target.id, { enabled: false })
      await platformUpstreamService.updateTarget(target.id, { enabled: true })
    }
    if (change === 'token') await platformUpstreamService.updateServiceToken(upstream.id, 'replacement-test-token-with-at-least-32-characters')
    if (change === 'configuration') await database.update(schema.upstreamServiceConnections).set({ configurationRevision: 2 }).where(eq(schema.upstreamServiceConnections.upstreamServiceId, upstream.id))
    if (change === 'membership') await platformUpstreamService.createTarget(upstream.id, { baseUrl: 'http://127.0.0.1:9090', weight: 1, enabled: true })
    ack.resolve(response())
    await rejected
    const [current] = await database.select().from(schema.upstreamTargets).where(eq(schema.upstreamTargets.id, target.id))
    expect(current!.configurationState).toBeNull()
    expect(isServiceTargetReady(current!, { configurationRevision: 1, configurationHash: hash })).toBe(false)
    expect(refreshPlatformRevision).not.toHaveBeenCalled()
  })

  it('accepts a fresh save after its own revision and Target state reset', async () => {
    const upstream = await configuredUpstream()
    vi.spyOn(serviceControlClient, 'updateConfiguration').mockResolvedValue(response(2))
    const result = await updatePlatformServiceConfiguration(upstream.id, { expectedRevision: 1, values: {}, secrets: {} })
    expect(result).toMatchObject({ status: 'synced', revision: 2, routingRevision: { id: 'published' } })
    expect(result.targets[0]).toMatchObject({ configurationRevision: 2, configurationStatus: 'synced' })
  })

  it('publishes successful Targets when another unchanged Target fails', async () => {
    const upstream = await configuredUpstream()
    await platformUpstreamService.createTarget(upstream.id, { baseUrl: 'http://127.0.0.1:9090', weight: 1, enabled: true })
    vi.spyOn(serviceControlClient, 'updateConfiguration').mockImplementation(async (url) => {
      if (url.includes('9090')) throw new Error('offline')
      return response()
    })
    const result = await synchronizePlatformServiceConfiguration(upstream.id)
    expect(result.status).toBe('partial')
    expect(result.targets.map(target => target.configurationStatus).sort()).toEqual(['error', 'synced'])
    expect(refreshPlatformRevision).toHaveBeenCalledOnce()
  })
})
