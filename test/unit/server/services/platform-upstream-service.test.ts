import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import { gatewayTargetHealth } from '~~/server/services/gateway-target-health'
import { withCommittedTransaction } from '~~/server/utils/committed-transaction'
import { encryptStoredSecret } from '~~/server/utils/stored-secret'
import * as availability from '~~/server/services/service-availability-service'
import { getPlatformUpstreamDetail } from '~~/server/services/platform-upstream-detail'

const testContext = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
}))
vi.stubGlobal('useRuntimeConfig', () => ({
  apiKeySecret: '0123456789abcdef0123456789abcdef'
}))

const { platformUpstreamService } = await import(
  '~~/server/services/platform-upstream-service'
)
const { platformRuntimeService } = await import(
  '~~/server/services/platform-runtime-service'
)
const { upstreamServiceTokenService } = await import(
  '~~/server/services/upstream-service-token-service'
)
const revisionCompiler = await import('~~/server/services/routing-revision-compiler')
const { loadServiceControlContext, commitServiceControlContext } = await import('~~/server/services/platform-service-control-context')

let client: PGlite
let database: ReturnType<typeof drizzle<typeof schema>>

beforeAll(async () => {
  client = new PGlite()
  database = drizzle(client, { schema })
  testContext.database = database
  await migrate(database, {
    migrationsFolder: resolve(
      process.cwd(),
      'server/db/migrations/postgresql'
    ),
    migrationsSchema: 'drizzle',
    migrationsTable: '__drizzle_migrations'
  })
})

beforeEach(async () => {
  await client.exec(
    'TRUNCATE TABLE platform_runtime, routing_revisions, api_products, upstream_services CASCADE;'
  )
  await platformRuntimeService.ensureDefault()
})

afterAll(async () => client.close())
afterEach(() => vi.restoreAllMocks())

it('reads and probes only the requested Upstream, exposing no stored credentials', async () => {
  const target = await createConfiguredTarget()
  const unrelated = await platformUpstreamService.create({
    slug: 'unrelated', name: 'Unrelated', loadBalancing: 'round_robin',
    serviceToken: 'unrelated-secret-token-at-least-32-characters',
    targets: [{ baseUrl: 'http://127.0.0.1:8089', weight: 1 }]
  })
  const probe = vi.spyOn(availability, 'resolveServiceAvailability').mockImplementation(async (_description, targets) => {
    if (targets.some(item => item.id === unrelated.targets[0]!.id)) throw new Error('unrelated Target is offline')
    return { overall: 'online', targets: new Map(targets.map(item => [item.id, 'online' as const])) }
  })
  const detail = await getPlatformUpstreamDetail(target.upstreamServiceId)
  expect(probe).toHaveBeenCalledOnce()
  expect(probe.mock.calls[0]![1].map(item => item.id)).toEqual([target.id])
  expect(detail.upstream.id).toBe(target.upstreamServiceId)
  expect(detail.upstream.targets.map(item => item.id)).toEqual([target.id])
  expect(detail.upstream.connection).toEqual(detail.connection)
  expect(detail.targets[0]?.availability).toBe('online')
  expect(JSON.stringify(detail)).not.toContain('Ciphertext')
  expect(JSON.stringify(detail)).not.toContain('openapi-test-service-token')
  await expect(getPlatformUpstreamDetail('00000000-0000-4000-8000-000000000001')).rejects.toMatchObject({ statusCode: 404 })
})

async function createConfiguredTarget() {
  const upstream = await platformUpstreamService.create({
    slug: 'service-target-state',
    name: 'Service Target State',
    serviceToken: 'openapi-test-service-token-with-at-least-32-characters',
    loadBalancing: 'round_robin',
    targets: [{ baseUrl: 'http://127.0.0.1:8080', weight: 1 }]
  })
  const target = upstream.targets[0]!
  const configured = (await database.update(schema.upstreamTargets).set({
    configurationRevision: 3,
    configurationHash: 'a'.repeat(64),
    configurationStatus: 'synced',
    configurationState: {
      schemaVersion: 1,
      serviceId: 'openapi-service',
      schemaSha256: 'b'.repeat(64),
      revision: 3,
      configurationSha256: 'a'.repeat(64),
      values: {},
      updatedAt: new Date().toISOString()
    },
    lastConfigurationSyncAt: new Date(),
    lastError: 'stale error'
  }).where(eq(schema.upstreamTargets.id, target.id)).returning())[0]!
  return configured
}

async function createActiveRoute(upstreamServiceId: string) {
  const [product] = await database.insert(schema.apiProducts).values({
    slug: 'rolling-update-test',
    name: 'Rolling Update Test'
  }).returning()
  const [version] = await database.insert(schema.apiVersions).values({
    productId: product!.id,
    version: 'v1',
    state: 'published'
  }).returning()
  await database.insert(schema.apiRoutes).values({
    apiVersionId: version!.id,
    name: 'Rolling update route',
    method: 'GET',
    pathPattern: '/v1/rolling-update',
    normalizedShape: '/v1/rolling-update',
    upstreamServiceId,
    upstreamPathTemplate: '/v1/rolling-update',
    state: 'active'
  })
}

describe('Platform upstream target state', () => {
  it.each(['update', 'remove'] as const)('preserves Target health when %s is rolled back by publication failure', async (operation) => {
    const target = await createConfiguredTarget()
    const reset = vi.spyOn(gatewayTargetHealth, 'reset')
    vi.spyOn(revisionCompiler, 'compileRoutingRevision').mockImplementationOnce(() => { throw new Error('publication rejected') })
    const mutation = operation === 'update'
      ? platformUpstreamService.updateTargetAndPublish(target.id, { enabled: false }, null)
      : platformUpstreamService.removeTargetAndPublish(target.id, null)
    await expect(mutation).rejects.toThrow('publication rejected')
    expect(reset).not.toHaveBeenCalled()
    expect((await database.select().from(schema.upstreamTargets).where(eq(schema.upstreamTargets.id, target.id)))[0])
      .toMatchObject({ id: target.id, enabled: true })
  })

  it.each(['update', 'remove'] as const)('clears Target health once, after the %s publication commits', async (operation) => {
    const target = await createConfiguredTarget()
    const reset = vi.spyOn(gatewayTargetHealth, 'reset')
    const compile = revisionCompiler.compileRoutingRevision
    vi.spyOn(revisionCompiler, 'compileRoutingRevision').mockImplementation((...args) => {
      expect(reset).not.toHaveBeenCalled()
      return compile(...args)
    })
    if (operation === 'update') await platformUpstreamService.updateTargetAndPublish(target.id, { enabled: false }, null)
    else await platformUpstreamService.removeTargetAndPublish(target.id, null)
    expect(reset).toHaveBeenCalledExactlyOnceWith(target.upstreamServiceId, target.id)
  })

  it('clears health after an address update commits without publishing an unverified Target', async () => {
    const target = await createConfiguredTarget()
    const reset = vi.spyOn(gatewayTargetHealth, 'reset')
    await platformUpstreamService.updateTargetAndPublish(target.id, { baseUrl: 'http://127.0.0.1:9090' }, null)
    expect(reset).toHaveBeenCalledExactlyOnceWith(target.upstreamServiceId, target.id)
  })

  it('promotes a verified Token and invalidates its cache only after the outer commit', async () => {
    const target = await createConfiguredTarget()
    const id = target.upstreamServiceId
    const active = await upstreamServiceTokenService.get(id)
    const replacement = 'replacement-token-to-verify-with-32-characters'
    await platformUpstreamService.updateServiceToken(id, replacement)
    await expect(upstreamServiceTokenService.get(id)).resolves.toBe(active)
    const expected = await loadServiceControlContext(id)
    const invalidate = vi.spyOn(upstreamServiceTokenService, 'invalidate')
    await commitServiceControlContext(expected, 'discovery', async (tx, current) => {
      const promoted = await upstreamServiceTokenService.promoteVerified(tx, current.connection)
      expect(invalidate).not.toHaveBeenCalled()
      await expect(upstreamServiceTokenService.get(id)).resolves.toBe(active)
      return promoted
    })
    expect(invalidate).toHaveBeenCalledExactlyOnceWith(id)
    await expect(upstreamServiceTokenService.get(id)).resolves.toBe(replacement)
    await expect(upstreamServiceTokenService.getForControl(id)).resolves.toBe(replacement)
    expect((await loadServiceControlContext(id)).connection.pendingServiceTokenCiphertext).toBeNull()
  })

  it('does not expose a promoted Token when the enclosing discovery transaction rolls back', async () => {
    const target = await createConfiguredTarget()
    const id = target.upstreamServiceId
    const original = await upstreamServiceTokenService.get(id)
    const replacement = 'replacement-token-to-verify-with-32-characters'
    await platformUpstreamService.updateServiceToken(id, replacement)
    const expected = await loadServiceControlContext(id)
    const invalidate = vi.spyOn(upstreamServiceTokenService, 'invalidate')
    await expect(commitServiceControlContext(expected, 'discovery', async (tx, current) => {
      await upstreamServiceTokenService.promoteVerified(tx, current.connection)
      throw new Error('Target persistence failed')
    })).rejects.toThrow('Target persistence failed')
    expect(invalidate).not.toHaveBeenCalled()
    expect((await loadServiceControlContext(id)).connection).toEqual(expected.connection)
    await expect(upstreamServiceTokenService.get(id)).resolves.toBe(original)
    await expect(upstreamServiceTokenService.getForControl(id)).resolves.toBe(replacement)
  })

  it('verifies the observed Token rather than a control cache predating another instance rotation', async () => {
    const target = await createConfiguredTarget()
    const id = target.upstreamServiceId
    const cached = await upstreamServiceTokenService.getForControl(id)
    const replacement = 'externally-staged-token-with-at-least-32-characters'
    await database.update(schema.upstreamServiceConnections).set({
      pendingServiceTokenCiphertext: encryptStoredSecret(replacement, 'service-token')
    }).where(eq(schema.upstreamServiceConnections.upstreamServiceId, id))
    const observed = await loadServiceControlContext(id)
    await expect(upstreamServiceTokenService.getForControl(id)).resolves.toBe(cached)
    expect(upstreamServiceTokenService.forVerification(observed.connection)).toBe(replacement)
  })

  it('cannot promote a stale pending credential over a newer rotation', async () => {
    const target = await createConfiguredTarget()
    const id = target.upstreamServiceId
    await platformUpstreamService.updateServiceToken(id, 'first-pending-token-with-at-least-32-characters')
    const old = await loadServiceControlContext(id)
    const replacement = 'second-pending-token-with-at-least-32-characters'
    await platformUpstreamService.updateServiceToken(id, replacement)
    await expect(withCommittedTransaction(tx => upstreamServiceTokenService.promoteVerified(tx, old.connection)))
      .rejects.toMatchObject({ data: { code: 'SERVICE_DISCOVERY_CONFLICT' } })
    await expect(upstreamServiceTokenService.getForControl(id)).resolves.toBe(replacement)
  })

  it('commits metadata and a pending Token together while preserving the live credential', async () => {
    const target = await createConfiguredTarget()
    const id = target.upstreamServiceId
    const original = await upstreamServiceTokenService.getForControl(id)
    const replacement = 'replacement-service-token-with-at-least-32-characters'
    const updated = await platformUpstreamService.updateAndPublish(id, { name: 'Updated together', serviceToken: replacement }, null)
    expect(updated.upstream.name).toBe('Updated together')
    await expect(upstreamServiceTokenService.getForControl(id)).resolves.toBe(replacement)
    await expect(upstreamServiceTokenService.get(id)).resolves.toBe(original)
  })

  it.each(['token', 'publication'] as const)('rolls back the whole edit when %s fails', async (failure) => {
    const target = await createConfiguredTarget()
    const id = target.upstreamServiceId
    const before = await platformUpstreamService.findById(id)
    const invalidate = vi.spyOn(upstreamServiceTokenService, 'invalidate')
    if (failure === 'publication') vi.spyOn(revisionCompiler, 'compileRoutingRevision').mockImplementationOnce(() => { throw new Error('publication rejected') })
    await expect(platformUpstreamService.updateAndPublish(id, {
      name: 'Must not be committed',
      serviceToken: failure === 'token' ? 'short' : 'replacement-service-token-with-at-least-32-characters'
    }, null)).rejects.toThrow()
    expect((await platformUpstreamService.findById(id))?.name).toBe(before!.name)
    const [connection] = await database.select().from(schema.upstreamServiceConnections).where(eq(schema.upstreamServiceConnections.upstreamServiceId, id))
    expect(connection!.pendingServiceTokenCiphertext).toBeNull()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('stages Service Token rotation and keeps the verified token on live traffic', async () => {
    const upstream = await platformUpstreamService.create({
      slug: 'staged-token-rotation',
      name: 'Staged Token Rotation',
      serviceToken: 'verified-service-token-with-at-least-32-characters',
      loadBalancing: 'round_robin',
      targets: [{ baseUrl: 'http://127.0.0.1:8080', weight: 1 }]
    })
    const before = (await database.select()
      .from(schema.upstreamServiceConnections)
      .where(eq(
        schema.upstreamServiceConnections.upstreamServiceId,
        upstream.id
      )))[0]!

    await platformUpstreamService.updateServiceToken(
      upstream.id,
      'replacement-service-token-with-at-least-32-characters'
    )
    const after = (await database.select()
      .from(schema.upstreamServiceConnections)
      .where(eq(
        schema.upstreamServiceConnections.upstreamServiceId,
        upstream.id
      )))[0]!

    expect(after.serviceTokenCiphertext).toBe(before.serviceTokenCiphertext)
    expect(after.pendingServiceTokenCiphertext).toBeTruthy()
    await expect(upstreamServiceTokenService.get(upstream.id))
      .resolves.toBe('verified-service-token-with-at-least-32-characters')
    await expect(upstreamServiceTokenService.getForControl(upstream.id))
      .resolves.toBe('replacement-service-token-with-at-least-32-characters')
  })

  it('rejects an absent Service Token before writing upstream records', async () => {
    await expect(platformUpstreamService.create({
      slug: 'missing-token',
      name: 'Missing Token',
      serviceToken: '',
      loadBalancing: 'round_robin',
      targets: [{ baseUrl: 'https://service.example.com', weight: 1 }]
    })).rejects.toMatchObject({ data: { code: 'SERVICE_TOKEN_REQUIRED' } })
    expect(await database.select().from(schema.upstreamServices)).toHaveLength(0)
    expect(await database.select().from(schema.upstreamTargets)).toHaveLength(0)
    expect(await database.select().from(schema.upstreamServiceConnections)).toHaveLength(0)
  })

  it('keeps unverified Target changes out of runtime', async () => {
    const upstream = await platformUpstreamService.create({
      slug: 'service-target-publication',
      name: 'Service Target Publication',
      serviceToken: 'openapi-test-service-token-with-at-least-32-characters',
      loadBalancing: 'round_robin',
      targets: [{ baseUrl: 'http://127.0.0.1:8080', weight: 1 }]
    })
    const created = await platformUpstreamService.createTargetAndPublish(
      upstream.id,
      {
        baseUrl: 'http://127.0.0.1:8081',
        weight: 1,
        enabled: true
      }, null
    )

    expect(created.revision).toBeNull()
  })

  it('resets Service state when a Target address changes', async () => {
    const target = await createConfiguredTarget()
    const updated = await platformUpstreamService.updateTargetAndPublish(target.id, {
      baseUrl: 'http://127.0.0.1:8081'
    }, null)

    expect(updated.target).toMatchObject({
      baseUrl: 'http://127.0.0.1:8081/',
      configurationRevision: null,
      configurationHash: null,
      configurationStatus: 'unknown',
      configurationState: null,
      lastConfigurationSyncAt: null,
      lastError: null
    })
  })

  it('resets Service state when a disabled Target is enabled again', async () => {
    const target = await createConfiguredTarget()
    await platformUpstreamService.updateTargetAndPublish(target.id, { enabled: false }, null)
    const updated = await platformUpstreamService.updateTargetAndPublish(target.id, {
      enabled: true
    }, null)

    expect(updated.target).toMatchObject({
      enabled: true,
      configurationRevision: null,
      configurationHash: null,
      configurationStatus: 'unknown',
      configurationState: null,
      lastConfigurationSyncAt: null,
      lastError: null
    })
  })

  it('keeps a ready Target online while another enabled Target is unverified', async () => {
    const readyTarget = await createConfiguredTarget()
    await platformUpstreamService.createTargetAndPublish(
      readyTarget.upstreamServiceId,
      {
        baseUrl: 'http://127.0.0.1:8081',
        weight: 1,
        enabled: true
      }, null
    )
    await createActiveRoute(readyTarget.upstreamServiceId)

    await expect(platformUpstreamService.updateTargetAndPublish(readyTarget.id, {
      enabled: false
    }, null)).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'UPSTREAM_LAST_TARGET_REQUIRED' }
    })

    expect(await database.query.upstreamTargets.findFirst({
      where: eq(schema.upstreamTargets.id, readyTarget.id)
    })).toMatchObject({ enabled: true })
  })

  it('serializes concurrent attempts to disable the last two Targets', async () => {
    const upstream = await platformUpstreamService.create({
      slug: 'concurrent-target-disable',
      name: 'Concurrent Target Disable',
      serviceToken: 'openapi-test-service-token-with-at-least-32-characters',
      loadBalancing: 'round_robin',
      targets: [
        { baseUrl: 'https://one.example.com', weight: 1 },
        { baseUrl: 'https://two.example.com', weight: 1 }
      ]
    })
    await database.update(schema.upstreamTargets).set({
      configurationRevision: 0,
      configurationHash: 'a'.repeat(64),
      configurationState: {
        schemaVersion: 1,
        serviceId: 'concurrent-target-disable',
        schemaSha256: 'b'.repeat(64),
        revision: 0,
        configurationSha256: 'a'.repeat(64),
        values: {},
        updatedAt: null
      }
    }).where(eq(schema.upstreamTargets.upstreamServiceId, upstream.id))
    await createActiveRoute(upstream.id)

    const results = await Promise.allSettled(upstream.targets.map(target => (
      platformUpstreamService.updateTargetAndPublish(target.id, { enabled: false }, null)
    )))

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const remaining = await database.select().from(schema.upstreamTargets)
      .where(eq(schema.upstreamTargets.upstreamServiceId, upstream.id))
    expect(remaining.filter(target => target.enabled)).toHaveLength(1)
  })
})
