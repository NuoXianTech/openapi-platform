import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'

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
    const created = await platformUpstreamService.createTarget(
      upstream.id,
      {
        baseUrl: 'http://127.0.0.1:8081',
        weight: 1,
        enabled: true
      }
    )

    expect(created.publishRouting).toBe(false)
  })

  it('resets Service state when a Target address changes', async () => {
    const target = await createConfiguredTarget()
    const updated = await platformUpstreamService.updateTarget(target.id, {
      baseUrl: 'http://127.0.0.1:8081'
    })

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
    await platformUpstreamService.updateTarget(target.id, { enabled: false })
    const updated = await platformUpstreamService.updateTarget(target.id, {
      enabled: true
    })

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
    await platformUpstreamService.createTarget(
      readyTarget.upstreamServiceId,
      {
        baseUrl: 'http://127.0.0.1:8081',
        weight: 1,
        enabled: true
      }
    )
    await createActiveRoute(readyTarget.upstreamServiceId)

    await expect(platformUpstreamService.updateTarget(readyTarget.id, {
      enabled: false
    })).rejects.toMatchObject({
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
      platformUpstreamService.updateTarget(target.id, { enabled: false })
    )))

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const remaining = await database.select().from(schema.upstreamTargets)
      .where(eq(schema.upstreamTargets.upstreamServiceId, upstream.id))
    expect(remaining.filter(target => target.enabled)).toHaveLength(1)
  })
})
