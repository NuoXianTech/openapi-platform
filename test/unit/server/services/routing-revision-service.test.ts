import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ServiceDescription,
  ServiceEndpointSummary
} from '#shared/types/service-control'
import { API_STATUS } from '#shared/config/api-status'
import * as schema from '~~/server/db/schema'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { createProductFixture } from '../../../fixtures/platform-product'

// Availability probes use the production DNS-pinned transport.  Delegate it
// to the test's stubbed global fetch so database/revision tests remain fully
// in-process and deterministic.
vi.mock('~~/server/utils/safe-fetch', () => ({
  safeFetch: (input: RequestInfo | URL, init?: RequestInit) => (
    globalThis.fetch(input, init)
  ),
  readLimitedText: async (response: Response, maxBytes: number) => {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new Error('upstream response is too large')
    }
    return text
  }
}))

const testContext = vi.hoisted(() => ({ database: null as unknown }))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
}))
vi.stubGlobal('useRuntimeConfig', () => ({
  apiKeySecret: '0123456789abcdef0123456789abcdef'
}))

const { platformProductService } = await import('~~/server/services/platform-product-service')
const { apiCatalogService } = await import('~~/server/services/api-catalog-service')
const { platformEndpointCatalogService } = await import('~~/server/services/platform-endpoint-catalog-service')
const { synchronizeEndpointSupportRoutes } = await import('~~/server/services/platform-endpoint-support-route-service')
const { applyPlatformRevision } = await import('~~/server/services/platform-endpoint-publication-service')
const { platformRouteService } = await import('~~/server/services/platform-route-service')
const { platformUpstreamService } = await import('~~/server/services/platform-upstream-service')
const { platformRuntimeService } = await import('~~/server/services/platform-runtime-service')
const { routingRevisionService } = await import('~~/server/services/routing-revision-service')
const { routingRuntimeService } = await import('~~/server/services/routing-runtime-service')

let client: PGlite
let database: ReturnType<typeof drizzle<typeof schema>>

beforeAll(async () => {
  client = new PGlite()
  database = drizzle(client, { schema })
  testContext.database = database
  await migrate(database, {
    migrationsFolder: resolve(process.cwd(), 'server/db/migrations/postgresql'),
    migrationsSchema: 'drizzle',
    migrationsTable: '__drizzle_migrations'
  })
})

beforeEach(async () => {
  await client.exec(
    'TRUNCATE TABLE platform_runtime, routing_revisions, api_products, upstream_services, openapi_documents CASCADE;'
  )
  await platformRuntimeService.ensureDefault()
})

afterAll(async () => client.close())

async function createRoutingGraph(options: {
  productSlug?: string
  routeName?: string
  hosts?: string[]
  pathPattern?: string
  upstreamPathTemplate?: string
  verified?: boolean
}) {
  const productSlug = options.productSlug ?? 'proxy-smoke'
  const product = await createProductFixture(database, {
    slug: productSlug,
    name: productSlug,
    visibility: 'public',
    version: 'v1'
  })
  const upstream = await platformUpstreamService.create({
    slug: `${productSlug}-service`,
    name: `${productSlug} service`,
    serviceToken: 'revision-test-service-token-with-at-least-32-characters',
    loadBalancing: 'round_robin',
    targets: [{ baseUrl: 'http://127.0.0.1:8080', weight: 1 }]
  })
  if (options.verified !== false) {
    await database.update(schema.upstreamTargets).set({
      configurationRevision: 0,
      configurationHash: '0'.repeat(64),
      configurationState: {
        schemaVersion: 1,
        serviceId: `${productSlug}-service`,
        schemaSha256: '1'.repeat(64),
        revision: 0,
        configurationSha256: '0'.repeat(64),
        values: {},
        updatedAt: null
      }
    }).where(eq(schema.upstreamTargets.upstreamServiceId, upstream.id))
  }
  const route = await platformRouteService.create({
    apiVersionId: product.versions[0]!.id,
    name: options.routeName ?? 'Proxy smoke',
    hosts: options.hosts ?? [],
    method: 'GET',
    pathPattern: options.pathPattern ?? '/v1/proxy-smoke/{id}',
    upstreamServiceId: upstream.id,
    upstreamPathTemplate: options.upstreamPathTemplate ?? '/healthz/{path.id}',
    timeoutMs: 5_000,
    maxRequestBytes: 1_048_576,
    maxResponseBytes: 10_485_760,
    state: 'active'
  })
  if (!route) throw new Error('route insert returned no row')

  return { product, route, upstream }
}

async function createDiscoveredService(options: {
  slug?: string
  name?: string
  path?: string
  summary?: string
  endpoints?: ServiceEndpointSummary[]
}) {
  const slug = options.slug ?? 'catalog-service'
  const name = options.name ?? 'Catalog Service'
  const path = options.path ?? '/v1/catalog/{id}'
  const endpoints = options.endpoints ?? [{
    method: 'GET',
    path,
    operationId: `${slug}-get`,
    summary: options.summary ?? 'Catalog endpoint',
    tags: [],
    system: false,
    support: false
  }]
  const upstream = await platformUpstreamService.create({
    slug,
    name,
    serviceToken: 'catalog-test-service-token-with-at-least-32-characters',
    loadBalancing: 'round_robin',
    targets: [{ baseUrl: 'http://127.0.0.1:8090', weight: 1 }]
  })
  const [document] = await database.insert(schema.openapiDocuments).values({
    upstreamServiceId: upstream.id,
    sourceType: 'url',
    sourceUrl: 'http://127.0.0.1:8090/openapi.json',
    format: 'json',
    specVersion: '3.1.0',
    content: {
      openapi: '3.1.0',
      paths: Object.fromEntries(endpoints.map(endpoint => [
        endpoint.path,
        {
          [endpoint.method.toLowerCase()]: {
            operationId: endpoint.operationId,
            summary: endpoint.summary,
            tags: endpoint.tags,
            ...(endpoint.support
              ? { 'x-openapi-platform': { support: true } }
              : {})
          }
        }
      ]))
    },
    contentHash: createHash('sha256').update(`${slug}:${path}`).digest('hex'),
    parsedSummary: {
      endpointCount: endpoints.filter(endpoint => (
        !endpoint.system && !endpoint.support
      )).length,
      endpoints
    },
    fetchedAt: new Date()
  }).returning()
  if (!document) throw new Error('OpenAPI test document was not created')
  await database.update(schema.upstreamServices)
    .set({ openapiDocumentId: document.id })
    .where(eq(schema.upstreamServices.id, upstream.id))
  await database.update(schema.upstreamTargets).set({
    configurationRevision: 0,
    configurationHash: '0'.repeat(64),
    configurationState: {
      schemaVersion: 1,
      serviceId: slug,
      schemaSha256: '1'.repeat(64),
      revision: 0,
      configurationSha256: '0'.repeat(64),
      values: {},
      updatedAt: null
    }
  }).where(eq(schema.upstreamTargets.upstreamServiceId, upstream.id))
  return { upstream, path, endpoints }
}

function routeMutationInput(route: typeof schema.apiRoutes.$inferSelect) {
  return {
    apiVersionId: route.apiVersionId,
    name: route.name,
    hosts: route.hosts,
    method: route.method,
    pathPattern: route.pathPattern,
    upstreamServiceId: route.upstreamServiceId,
    upstreamPathTemplate: route.upstreamPathTemplate,
    isApiKey: route.isApiKey,
    isStatistics: route.isStatistics,
    creditsCost: route.creditsCost,
    rateLimitPerSecond: route.rateLimitPerSecond,
    rateLimitPerMinute: route.rateLimitPerMinute,
    rateLimitPerHour: route.rateLimitPerHour,
    rateLimitPerDay: route.rateLimitPerDay,
    timeoutMs: route.timeoutMs,
    maxRequestBytes: route.maxRequestBytes,
    maxResponseBytes: route.maxResponseBytes,
    catalogStatus: route.catalogStatus,
    sensitiveQueryParameters: route.sensitiveQueryParameters,
    state: route.state
  }
}

describe('routing revision service', () => {
  it('returns bounded management list pages with stable totals', async () => {
    await createRoutingGraph({ productSlug: 'paged-management' })
    await applyPlatformRevision(null)

    const products = await platformProductService.listPage({ limit: 1, offset: 0 })
    const upstreams = await platformUpstreamService.listPage({
      checkAvailability: false,
      limit: 1,
      offset: 0
    })
    const revisions = await routingRevisionService.listPage({ limit: 1, offset: 0 })

    expect(products.total).toBe(1)
    expect(products.items).toHaveLength(1)
    expect(upstreams.total).toBe(1)
    expect(upstreams.items).toHaveLength(1)
    expect(revisions.total).toBe(1)
    expect(revisions.items).toHaveLength(1)
  })

  it('keeps an unverified Target out of published routing', async () => {
    const graph = await createRoutingGraph({ verified: false })

    const skipped = await routingRevisionService.publish(null)
    expect(skipped.configPayload.upstreams).toEqual([])
    expect(skipped.configPayload.routes).toEqual([])

    await database.update(schema.upstreamTargets).set({
      configurationRevision: 0,
      configurationHash: '0'.repeat(64),
      configurationState: {
        schemaVersion: 1,
        serviceId: 'verified-service',
        schemaSha256: '1'.repeat(64),
        revision: 0,
        configurationSha256: '0'.repeat(64),
        values: {},
        updatedAt: null
      }
    }).where(eq(
      schema.upstreamTargets.upstreamServiceId,
      graph.upstream.id
    ))

    const published = await routingRevisionService.publish(null)
    expect(published.sequence).toBe(2)
    expect(published.configPayload.upstreams.map(upstream => upstream.id))
      .toEqual([graph.upstream.id])
  })

  it('publishes verified Services while another Service waits for discovery', async () => {
    await createRoutingGraph({
      productSlug: 'waiting-service',
      pathPattern: '/v1/waiting-service',
      upstreamPathTemplate: '/healthz',
      verified: false
    })
    const verified = await createRoutingGraph({
      productSlug: 'verified-service',
      pathPattern: '/v1/verified-service',
      upstreamPathTemplate: '/healthz'
    })

    const published = await routingRevisionService.publish(null)
    expect(published.configPayload.routes.map(route => route.id))
      .toContain(verified.route.id)
    expect(published.configPayload.routes.map(route => route.pathPattern))
      .not.toContain('/v1/waiting-service')
  })

  it('bootstraps the runtime singleton idempotently', async () => {
    await platformRuntimeService.ensureDefault()
    const rows = await database.select().from(schema.platformRuntime)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 1,
      defaultDomain: null,
      activeRevisionId: null
    })
  })

  it('allows an existing disabled upstream binding but rejects a new one', async () => {
    const disabled = await createRoutingGraph({ productSlug: 'disabled-upstream' })
    const active = await createRoutingGraph({ productSlug: 'active-upstream' })
    await platformUpstreamService.update(disabled.upstream.id, { status: 'disabled' })

    await expect(platformRouteService.update(
      disabled.route.id,
      routeMutationInput(disabled.route)
    )).resolves.toMatchObject({ upstreamServiceId: disabled.upstream.id })

    await expect(platformRouteService.update(
      active.route.id,
      {
        ...routeMutationInput(active.route),
        upstreamServiceId: disabled.upstream.id
      }
    )).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'UPSTREAM_NOT_ACTIVE' }
    })
  })

  it('rejects a second runtime row', async () => {
    await expect(database.insert(schema.platformRuntime).values({
      id: 2,
      defaultDomain: 'second.example.test'
    })).rejects.toThrow()

    expect(await database.select().from(schema.platformRuntime)).toHaveLength(1)
  })

  it('publishes an immutable runtime payload and can roll back to it', async () => {
    const graph = await createRoutingGraph({})
    expect(graph.product.versions[0]).toMatchObject({ state: 'published' })
    expect(graph.product.versions[0]?.publishedAt).toBeInstanceOf(Date)

    const firstRevision = await routingRevisionService.publish(null)
    const payload = firstRevision.configPayload

    expect(firstRevision).toMatchObject({ sequence: 1 })
    expect(firstRevision.publishedAt).toBeInstanceOf(Date)
    expect(firstRevision.checksum).toBe(
      createHash('sha256').update(canonicalJson(payload)).digest('hex')
    )
    expect(payload.routes).toHaveLength(1)
    expect(payload.upstreams).toHaveLength(1)

    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/proxy-smoke/42',
      'api.example.test'
    )).resolves.toMatchObject({
      revisionId: firstRevision.id,
      route: { id: graph.route.id },
      params: { id: '42' }
    })

    await platformRouteService.create({
      apiVersionId: graph.product.versions[0]!.id,
      name: 'Second route',
      hosts: [],
      method: 'GET',
      pathPattern: '/v1/revision-two-only',
      upstreamServiceId: graph.upstream.id,
      upstreamPathTemplate: '/readyz',
      timeoutMs: 5_000,
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 10_485_760,
      state: 'active'
    })

    const secondRevision = await routingRevisionService.publish(null)
    expect(secondRevision).toMatchObject({ sequence: 2 })
    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/revision-two-only',
      'api.example.test'
    )).resolves.toMatchObject({ revisionId: secondRevision.id })

    const activated = await routingRevisionService.activate(firstRevision.id)
    expect(activated.id).toBe(firstRevision.id)

    const runtime = (await database.select().from(schema.platformRuntime))[0]!
    const revisions = await database.select().from(schema.routingRevisions)

    expect(runtime.activeRevisionId).toBe(firstRevision.id)
    expect(revisions.map(revision => revision.id)).toEqual(expect.arrayContaining([
      firstRevision.id,
      secondRevision.id
    ]))
    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/revision-two-only',
      'api.example.test'
    )).resolves.toBeNull()
  })

  it('restores the snapshotted default domain when activating a revision', async () => {
    const graph = await createRoutingGraph({
      productSlug: 'revision-domain',
      pathPattern: '/v1/revision-domain',
      upstreamPathTemplate: '/healthz'
    })
    const first = await platformRuntimeService.updateDefaultDomain(
      'first.example.test',
      null
    )
    const second = await platformRuntimeService.updateDefaultDomain(
      'second.example.test',
      null
    )

    expect(first.revision.configPayload.defaultDomain).toBe('first.example.test')
    expect(second.revision.configPayload.defaultDomain).toBe('second.example.test')
    await routingRevisionService.activate(first.revision.id)

    const [runtime] = await database.select().from(schema.platformRuntime)
    expect(runtime?.defaultDomain).toBe('first.example.test')
    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/revision-domain',
      'first.example.test'
    )).resolves.toMatchObject({ route: { id: graph.route.id } })
    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/revision-domain',
      'second.example.test'
    )).resolves.toBeNull()
  })

  it('reuses the active revision when the runtime configuration is unchanged', async () => {
    await createRoutingGraph({})

    const firstRevision = await routingRevisionService.publish(null)
    const repeatedRevision = await routingRevisionService.publish(null)
    const revisions = await database.select().from(schema.routingRevisions)

    expect(repeatedRevision.id).toBe(firstRevision.id)
    expect(repeatedRevision.sequence).toBe(1)
    expect(revisions).toHaveLength(1)
  })

  it('creates a new revision when an upstream target changes', async () => {
    const graph = await createRoutingGraph({})
    await routingRevisionService.publish(null)

    await database.update(schema.upstreamTargets)
      .set({ baseUrl: 'http://127.0.0.1:8081' })
      .where(eq(schema.upstreamTargets.upstreamServiceId, graph.upstream.id))

    const changedRevision = await routingRevisionService.publish(null)
    const revisions = await database.select().from(schema.routingRevisions)

    expect(changedRevision.sequence).toBe(2)
    expect(changedRevision.configPayload.upstreams[0]?.targets[0]?.baseUrl)
      .toBe('http://127.0.0.1:8081')
    expect(revisions).toHaveLength(2)
  })

  it('keeps the last verified Targets of an unavailable Upstream', async () => {
    const unavailable = await createRoutingGraph({
      productSlug: 'unavailable-service'
    })
    const changing = await createRoutingGraph({
      productSlug: 'changing-service',
      pathPattern: '/v1/changing-service',
      upstreamPathTemplate: '/healthz'
    })
    const firstRevision = await routingRevisionService.publish(null)
    const previousTargets = firstRevision.configPayload.upstreams.find(
      upstream => upstream.id === unavailable.upstream.id
    )!.targets

    await database.update(schema.upstreamTargets).set({
      configurationStatus: 'error'
    }).where(eq(
      schema.upstreamTargets.upstreamServiceId,
      unavailable.upstream.id
    ))
    await database.update(schema.upstreamTargets).set({
      baseUrl: 'http://127.0.0.1:8082'
    }).where(eq(
      schema.upstreamTargets.upstreamServiceId,
      changing.upstream.id
    ))

    const secondRevision = await routingRevisionService.publish(null)

    expect(secondRevision.sequence).toBe(2)
    expect(secondRevision.configPayload.upstreams.find(
      upstream => upstream.id === unavailable.upstream.id
    )?.targets).toEqual(previousTargets)
    expect(secondRevision.configPayload.upstreams.find(
      upstream => upstream.id === changing.upstream.id
    )?.targets[0]?.baseUrl).toBe('http://127.0.0.1:8082')
  })

  it('does not keep a disabled Target in the runtime fallback', async () => {
    const graph = await createRoutingGraph({
      productSlug: 'disabled-runtime-target'
    })
    const firstRevision = await routingRevisionService.publish(null)

    await database.update(schema.upstreamTargets).set({
      enabled: false,
      configurationStatus: 'error'
    }).where(eq(schema.upstreamTargets.upstreamServiceId, graph.upstream.id))

    const secondRevision = await routingRevisionService.publish(null)

    expect(secondRevision.id).not.toBe(firstRevision.id)
    expect(secondRevision.configPayload.upstreams).toHaveLength(0)
    expect(secondRevision.configPayload.routes).toHaveLength(0)
  })

  it('serializes concurrent publication and preserves one active revision', async () => {
    await createRoutingGraph({})

    const published = await Promise.all(Array.from(
      { length: 4 },
      () => routingRevisionService.publish(null)
    ))
    const revisions = await database.select().from(schema.routingRevisions)
    const [runtime] = await database.select().from(schema.platformRuntime)

    expect(new Set(published.map(revision => revision.id)).size).toBe(1)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]).toMatchObject({ sequence: 1 })
    expect(revisions[0]?.publishedAt).toBeInstanceOf(Date)
    expect(runtime?.activeRevisionId).toBe(revisions[0]?.id)
  })

  it('keeps deprecated products live and marks them deprecated in the catalog', async () => {
    const graph = await createRoutingGraph({ productSlug: 'deprecated-product' })
    const first = await routingRevisionService.publish(null)

    await platformProductService.update(graph.product.id, {
      lifecycle: 'deprecated'
    })
    const second = await routingRevisionService.publish(null)
    const catalog = await apiCatalogService.listPublicApis()

    expect(second.id).not.toBe(first.id)
    expect(second.configPayload.routes).toHaveLength(1)
    expect(second.configPayload.routes[0]).toMatchObject({
      id: graph.route.id,
      productLifecycle: 'deprecated'
    })
    expect(catalog.items).toContainEqual(expect.objectContaining({
      id: graph.product.id,
      status: API_STATUS.deprecated
    }))
  })

  it('protects every object referenced by the active revision from deletion', async () => {
    const graph = await createRoutingGraph({ productSlug: 'protected-graph' })
    await routingRevisionService.publish(null)

    await expect(platformRouteService.remove(graph.route.id))
      .rejects.toMatchObject({ data: { code: 'ROUTE_STILL_PUBLISHED' } })
    await expect(platformProductService.remove(graph.product.id))
      .rejects.toMatchObject({ data: { code: 'PRODUCT_STILL_PUBLISHED' } })
    await expect(platformProductService.removeVersion(graph.product.versions[0]!.id))
      .rejects.toMatchObject({ data: { code: 'VERSION_STILL_PUBLISHED' } })
    await expect(platformUpstreamService.remove(graph.upstream.id))
      .rejects.toMatchObject({ data: { code: 'UPSTREAM_STILL_PUBLISHED' } })
    await expect(platformUpstreamService.removeTarget(graph.upstream.targets[0]!.id))
      .rejects.toMatchObject({ data: { code: 'TARGET_STILL_PUBLISHED' } })
  })

  it('excludes routes whose API version is not published', async () => {
    const graph = await createRoutingGraph({})
    await database.update(schema.apiVersions)
      .set({ state: 'draft', publishedAt: null })
      .where(eq(schema.apiVersions.id, graph.product.versions[0]!.id))

    const revision = await routingRevisionService.publish(null)

    expect(revision.configPayload.routes).toHaveLength(0)
    expect(revision.configPayload.upstreams).toHaveLength(0)
  })

  it('rejects ambiguous routes before changing the active revision', async () => {
    const firstGraph = await createRoutingGraph({
      productSlug: 'first',
      pathPattern: '/v1/items/{id}',
      upstreamPathTemplate: '/items/{path.id}'
    })
    const secondProduct = await createProductFixture(database, {
      slug: 'second',
      name: 'Second',
      visibility: 'public',
      version: 'v1'
    })
    await platformRouteService.create({
      apiVersionId: secondProduct.versions[0]!.id,
      name: 'Conflicting route',
      hosts: [],
      method: 'GET',
      pathPattern: '/v1/items/{itemId}',
      upstreamServiceId: firstGraph.upstream.id,
      upstreamPathTemplate: '/items/{path.itemId}',
      timeoutMs: 5_000,
      maxRequestBytes: 1_048_576,
      maxResponseBytes: 10_485_760,
      state: 'active'
    })

    await expect(routingRevisionService.publish(null))
      .rejects.toMatchObject({
        statusCode: 409,
        data: { code: 'REVISION_ROUTE_CONFLICT' }
      })

    const runtime = (await database.select().from(schema.platformRuntime))[0]!
    const revisions = await database.select().from(schema.routingRevisions)
    expect(runtime.activeRevisionId).toBeNull()
    expect(revisions).toHaveLength(0)
  })

  it('prefers a host-specific route over the any-Host fallback', async () => {
    const fallbackGraph = await createRoutingGraph({
      productSlug: 'fallback',
      pathPattern: '/v1/items/{id}',
      upstreamPathTemplate: '/items/{path.id}'
    })
    const exactGraph = await createRoutingGraph({
      productSlug: 'exact',
      hosts: ['api.example.test'],
      pathPattern: '/v1/items/special',
      upstreamPathTemplate: '/items/special'
    })
    await routingRevisionService.publish(null)

    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/items/special',
      'api.example.test'
    )).resolves.toMatchObject({ route: { id: exactGraph.route.id } })
    // The host-specific Route declines other domains, so the fallback shape
    // takes the same path with `special` captured as the parameter.
    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/items/special',
      'other.example.test'
    )).resolves.toMatchObject({
      route: { id: fallbackGraph.route.id },
      params: { id: 'special' }
    })
    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/items/42',
      'other.example.test'
    )).resolves.toMatchObject({ route: { id: fallbackGraph.route.id } })
  })

  it('confines Routes without their own Host to the default domain', async () => {
    const graph = await createRoutingGraph({
      productSlug: 'default-domain',
      pathPattern: '/v1/default-domain',
      upstreamPathTemplate: '/healthz'
    })
    await routingRevisionService.publish(null)

    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/default-domain',
      'anything.example.test'
    )).resolves.toMatchObject({ route: { id: graph.route.id } })

    await platformRuntimeService.updateDefaultDomain('api.example.test', null)

    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/default-domain',
      'api.example.test'
    )).resolves.toMatchObject({ route: { id: graph.route.id } })
    await expect(routingRuntimeService.resolve(
      'GET',
      '/v1/default-domain',
      'anything.example.test'
    )).resolves.toBeNull()
  })

  it('publishes discovered Service endpoints and applies governance changes automatically', async () => {
    const service = await createDiscoveredService({})

    let catalog = await platformEndpointCatalogService.list()
    let item = catalog.services
      .find(entry => entry.upstream.id === service.upstream.id)
      ?.endpoints[0]
    expect(item).toMatchObject({
      sourceKind: 'discovered',
      status: 'available',
      route: null,
      publishable: true
    })

    const published = await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: service.path
    }, null)
    expect(published).toMatchObject({
      created: true,
      revision: { sequence: 1 }
    })
    expect(published.route).toMatchObject({
      pathPattern: service.path,
      upstreamPathTemplate: '/v1/catalog/{path.id}',
      isApiKey: false,
      isStatistics: true,
      creditsCost: 0,
      state: 'active'
    })

    const unchanged = await platformEndpointCatalogService.update(
      published.route.id,
      {},
      null
    )
    expect(unchanged).toMatchObject({
      revision: { id: published.revision?.id, sequence: 1 }
    })
    expect(await database.select().from(schema.routingRevisions)).toHaveLength(1)

    const statistics = await platformEndpointCatalogService.update(
      published.route.id,
      { isStatistics: false },
      null
    )
    expect(statistics).toMatchObject({
      revision: { sequence: 2 },
      route: { isStatistics: false }
    })

    const disabled = await platformEndpointCatalogService.update(
      published.route.id,
      { enabled: false },
      null
    )
    expect(disabled).toMatchObject({
      revision: { sequence: 3 },
      route: { state: 'disabled' }
    })

    catalog = await platformEndpointCatalogService.list()
    item = catalog.services
      .find(entry => entry.upstream.id === service.upstream.id)
      ?.endpoints[0]
    expect(item).toMatchObject({
      status: 'disabled',
      route: { route: { isStatistics: false, state: 'disabled' } }
    })
    expect(catalog.totals).toMatchObject({ live: 0, disabled: 1, pending: 0 })
  })

  it('saves multiple catalog changes and applies one shared runtime snapshot', async () => {
    const firstService = await createDiscoveredService({
      slug: 'batch-catalog-one',
      path: '/v1/catalog-one/{id}'
    })
    const secondService = await createDiscoveredService({
      slug: 'batch-catalog-two',
      path: '/v1/catalog-two/{id}'
    })

    const firstSaved = await platformEndpointCatalogService.publish({
      upstreamServiceId: firstService.upstream.id,
      method: 'GET',
      path: firstService.path
    }, null, { publishRouting: false })
    const secondSaved = await platformEndpointCatalogService.publish({
      upstreamServiceId: secondService.upstream.id,
      method: 'GET',
      path: secondService.path
    }, null, { publishRouting: false })

    expect(firstSaved.revision).toBeNull()
    expect(secondSaved.revision).toBeNull()
    expect(await database.select().from(schema.routingRevisions)).toHaveLength(0)

    const applied = await applyPlatformRevision(null)
    const repeated = await applyPlatformRevision(null)
    const revisions = await database.select().from(schema.routingRevisions)

    expect(applied.revision).toMatchObject({ sequence: 1 })
    expect(repeated.revision?.id).toBe(applied.revision?.id)
    expect(revisions).toHaveLength(1)
    expect(revisions[0]?.configPayload.routes).toHaveLength(2)
  })

  it('rejects publishing endpoints absent from the discovered contract', async () => {
    const service = await createDiscoveredService({
      slug: 'managed-route-service'
    })
    await expect(platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: '/v1/unknown'
    }, null)).rejects.toMatchObject({ data: { code: 'SERVICE_ENDPOINT_NOT_FOUND' } })
    expect(await database.select().from(schema.apiRoutes)).toHaveLength(0)
  })

  it('groups tagged operations as one Product and manages support routes invisibly', async () => {
    const service = await createDiscoveredService({
      slug: 'player-catalog-service',
      name: 'Player Catalog Service',
      endpoints: [
        {
          method: 'GET',
          path: '/v1/player',
          operationId: 'getDplayerHTML',
          summary: 'DPlayer',
          tags: ['Player'],
          system: false,
          support: false
        },
        {
          method: 'GET',
          path: '/v1/player/art',
          operationId: 'getArtplayerHTML',
          summary: 'ArtPlayer',
          tags: ['Player'],
          system: false,
          support: false
        },
        {
          method: 'GET',
          path: '/v1/player/assets/{asset}',
          operationId: 'getPlayerAsset',
          summary: 'Player asset',
          tags: ['Player'],
          system: false,
          support: true
        }
      ]
    })

    let catalog = await platformEndpointCatalogService.list()
    expect(catalog.services.find(entry => (
      entry.upstream.id === service.upstream.id
    ))?.endpoints.map(item => item.endpoint?.path)).toEqual([
      '/v1/player',
      '/v1/player/art'
    ])

    const dplayer = await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: '/v1/player'
    }, null)
    let routes = (await platformRouteService.list())
      .filter(binding => binding.route.upstreamServiceId === service.upstream.id)
    expect(routes).toHaveLength(2)
    expect(new Set(routes.map(binding => binding.product.id)).size).toBe(1)
    expect(routes[0]?.product).toMatchObject({
      slug: 'player-catalog-service-player',
      name: 'Player'
    })
    expect(routes.find(binding => (
      binding.route.pathPattern === '/v1/player/assets/{asset}'
    ))?.route).toMatchObject({
      isApiKey: false,
      isStatistics: false,
      creditsCost: 0,
      state: 'active'
    })

    catalog = await platformEndpointCatalogService.list()
    expect(catalog.services.find(entry => (
      entry.upstream.id === service.upstream.id
    ))?.endpoints).toHaveLength(2)

    const artplayer = await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: '/v1/player/art'
    }, null)
    routes = (await platformRouteService.list())
      .filter(binding => binding.route.upstreamServiceId === service.upstream.id)
    expect(routes).toHaveLength(3)
    expect(new Set(routes.map(binding => binding.product.id)).size).toBe(1)

    await platformEndpointCatalogService.update(
      dplayer.route.id,
      { enabled: false },
      null
    )
    routes = (await platformRouteService.list())
      .filter(binding => binding.route.upstreamServiceId === service.upstream.id)
    expect(routes.find(binding => (
      binding.route.pathPattern === '/v1/player/assets/{asset}'
    ))?.route.state).toBe('active')

    await platformEndpointCatalogService.update(
      artplayer.route.id,
      { enabled: false },
      null
    )
    routes = (await platformRouteService.list())
      .filter(binding => binding.route.upstreamServiceId === service.upstream.id)
    expect(routes.find(binding => (
      binding.route.pathPattern === '/v1/player/assets/{asset}'
    ))?.route.state).toBe('disabled')
  })

  it('preserves generated group identifiers and edited metadata across publications', async () => {
    const service = await createDiscoveredService({
      slug: 'managed-groups',
      endpoints: ['/v1/weather', '/v1/forecast'].map(path => ({
        method: 'GET', path, operationId: null, summary: path,
        tags: ['Weather'], system: false, support: false
      }))
    })
    const first = await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id, method: 'GET', path: '/v1/weather'
    }, null)
    const original = await platformRouteService.get(first.route.id)
    const groupPatch = {
      name: 'Weather forecast', slug: 'must-not-change', summary: 'Edited summary',
      description: 'Edited description', visibility: 'private' as const,
      lifecycle: 'deprecated' as const
    }
    const versionPatch = {
      version: 'v99', productId: crypto.randomUUID(),
      state: 'deprecated' as const, changelog: 'Keep this changelog'
    }
    await platformProductService.update(original.product.id, groupPatch)
    await platformProductService.updateVersion(original.version.id, versionPatch)

    const second = await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id, method: 'GET', path: '/v1/forecast'
    }, null)
    const updated = await platformRouteService.get(second.route.id)
    expect(updated.product).toMatchObject({
      id: original.product.id, slug: 'managed-groups-weather',
      name: groupPatch.name, summary: groupPatch.summary, description: groupPatch.description,
      visibility: 'private', lifecycle: 'deprecated'
    })
    expect(updated.version).toMatchObject({
      id: original.version.id, productId: original.product.id, version: 'v1',
      state: 'deprecated', changelog: versionPatch.changelog
    })
    expect(await database.select().from(schema.apiProducts)).toHaveLength(1)
    expect(await database.select().from(schema.apiVersions)).toHaveLength(1)
  })

  it.each([
    ['group', 'PRODUCT_NOT_PUBLISHABLE'],
    ['version', 'VERSION_NOT_PUBLISHABLE']
  ] as const)('does not reactivate a retired %s when publishing an endpoint', async (kind, code) => {
    const service = await createDiscoveredService({})
    const published = await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id, method: 'GET', path: service.path
    }, null)
    const binding = await platformRouteService.get(published.route.id)
    if (kind === 'group') {
      await platformProductService.update(binding.product.id, { lifecycle: 'retired' })
    } else {
      await platformProductService.updateVersion(binding.version.id, { state: 'retired' })
    }
    await expect(platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id, method: 'GET', path: service.path
    }, null)).rejects.toMatchObject({ data: { code } })
    const after = await platformRouteService.get(published.route.id)
    expect(kind === 'group' ? after.product.lifecycle : after.version.state).toBe('retired')
    expect(await database.select().from(schema.apiRoutes)).toHaveLength(1)
  })

  it('reconciles added and removed support routes from the discovered contract', async () => {
    const publicEndpoint: ServiceEndpointSummary = {
      method: 'GET',
      path: '/v1/viewer',
      operationId: 'getViewer',
      summary: 'Viewer',
      tags: ['Viewer'],
      system: false,
      support: false
    }
    const supportEndpoint: ServiceEndpointSummary = {
      method: 'GET',
      path: '/v1/viewer/assets/{asset}',
      operationId: 'getViewerAsset',
      summary: 'Viewer asset',
      tags: ['Viewer'],
      system: false,
      support: true
    }
    const service = await createDiscoveredService({
      slug: 'viewer-catalog-service',
      endpoints: [publicEndpoint, supportEndpoint]
    })
    await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: publicEndpoint.path
    }, null)

    await synchronizeEndpointSupportRoutes({
      upstream: service.upstream,
      serviceName: 'Viewer Catalog Service',
      endpoints: [publicEndpoint]
    })
    let supportRoute = (await platformRouteService.list()).find(binding => (
      binding.route.upstreamServiceId === service.upstream.id
      && binding.route.isSupportRoute
    ))
    expect(supportRoute?.route.state).toBe('disabled')

    await synchronizeEndpointSupportRoutes({
      upstream: service.upstream,
      serviceName: 'Viewer Catalog Service',
      endpoints: [publicEndpoint, supportEndpoint]
    })
    supportRoute = (await platformRouteService.list()).find(binding => (
      binding.route.upstreamServiceId === service.upstream.id
      && binding.route.isSupportRoute
    ))
    expect(supportRoute?.route).toMatchObject({
      pathPattern: supportEndpoint.path,
      state: 'active'
    })
  })

  it('keeps support routes inside their path version', async () => {
    const service = await createDiscoveredService({
      slug: 'versioned-player-service',
      endpoints: [
        {
          method: 'GET',
          path: '/v1/player',
          operationId: 'getV1Player',
          summary: 'Player v1',
          tags: ['Player'],
          system: false,
          support: false
        },
        {
          method: 'GET',
          path: '/v1/player/assets/{asset}',
          operationId: 'getV1PlayerAsset',
          summary: 'Player asset v1',
          tags: ['Player'],
          system: false,
          support: true
        },
        {
          method: 'GET',
          path: '/v2/player',
          operationId: 'getV2Player',
          summary: 'Player v2',
          tags: ['Player'],
          system: false,
          support: false
        },
        {
          method: 'GET',
          path: '/v2/player/assets/{asset}',
          operationId: 'getV2PlayerAsset',
          summary: 'Player asset v2',
          tags: ['Player'],
          system: false,
          support: true
        }
      ]
    })

    const v1 = await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: '/v1/player'
    }, null)
    await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: '/v2/player'
    }, null)

    let routes = (await platformRouteService.list())
      .filter(binding => binding.route.upstreamServiceId === service.upstream.id)
    expect(routes.filter(binding => (
      binding.route.pathPattern.includes('/assets/')
    )).map(binding => ({
      path: binding.route.pathPattern,
      state: binding.route.state,
      version: binding.version.version
    }))).toEqual([
      {
        path: '/v1/player/assets/{asset}',
        state: 'active',
        version: 'v1'
      },
      {
        path: '/v2/player/assets/{asset}',
        state: 'active',
        version: 'v2'
      }
    ])

    await platformEndpointCatalogService.update(
      v1.route.id,
      { enabled: false },
      null
    )
    routes = (await platformRouteService.list())
      .filter(binding => binding.route.upstreamServiceId === service.upstream.id)
    expect(routes.filter(binding => (
      binding.route.pathPattern.includes('/assets/')
    )).map(binding => ({
      path: binding.route.pathPattern,
      state: binding.route.state,
      version: binding.version.version
    }))).toEqual([
      {
        path: '/v1/player/assets/{asset}',
        state: 'disabled',
        version: 'v1'
      },
      {
        path: '/v2/player/assets/{asset}',
        state: 'active',
        version: 'v2'
      }
    ])
  })

  it('checks availability once while loading and skips it during publication', async () => {
    const service = await createDiscoveredService({
      slug: 'availability-catalog-service'
    })
    const description: ServiceDescription = {
      schemaVersion: 1,
      serviceId: 'availability-catalog-service',
      name: 'Availability catalog Service',
      version: '0.1.0',
      commit: 'test',
      openapi: '/openapi.json',
      openapiSha256: '0'.repeat(64),
      health: '/healthz',
      readiness: '/readyz',
      configuration: {
        schema: '/.well-known/configuration-schema.json',
        state: '/.well-known/configuration.json',
        update: '/.well-known/configuration',
        schemaSha256: '1'.repeat(64)
      },
      serviceProtocol: 'openapi-service/v1'
    }
    await database.update(schema.upstreamServiceConnections).set({
      serviceId: description.serviceId,
      serviceDescription: description
    }).where(eq(
      schema.upstreamServiceConnections.upstreamServiceId,
      service.upstream.id
    ))

    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 })
    )
    try {
      const catalog = await platformEndpointCatalogService.list()

      expect(catalog.services.find(item => (
        item.upstream.id === service.upstream.id
      ))?.upstream.connection).toMatchObject({
        discovered: true,
        availability: 'online'
      })
      expect(request).toHaveBeenCalledTimes(2)
      expect(request.mock.calls[0]?.[0].toString())
        .toBe('http://127.0.0.1:8090/readyz')
      expect(request.mock.calls[1]?.[0].toString())
        .toBe('http://127.0.0.1:8090/.well-known/configuration.json')

      request.mockClear()
      await platformEndpointCatalogService.publish({
        upstreamServiceId: service.upstream.id,
        method: 'GET',
        path: service.path
      }, null)
      expect(request).not.toHaveBeenCalled()
    } finally {
      request.mockRestore()
    }
  })

  it('rolls back an endpoint mutation when publication conflicts', async () => {
    const active = await createRoutingGraph({
      productSlug: 'active-conflict',
      pathPattern: '/v1/conflict/{id}',
      upstreamPathTemplate: '/conflict/{path.id}'
    })
    const firstRevision = await routingRevisionService.publish(null)
    const service = await createDiscoveredService({
      slug: 'waiting-service',
      path: '/v1/conflict/{itemId}'
    })

    await expect(platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: service.path
    }, null)).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'REVISION_ROUTE_CONFLICT' }
    })
    const [runtime] = await database.select().from(schema.platformRuntime)
    expect(runtime?.activeRevisionId).toBe(firstRevision.id)

    let catalog = await platformEndpointCatalogService.list()
    expect(catalog.services
      .find(entry => entry.upstream.id === service.upstream.id)
      ?.endpoints[0]).toMatchObject({ status: 'available', route: null })

    const resolved = await platformEndpointCatalogService.update(
      active.route.id,
      { enabled: false },
      null
    )
    expect(resolved).toMatchObject({
      revision: { sequence: 2 }
    })

    const published = await platformEndpointCatalogService.publish({
      upstreamServiceId: service.upstream.id,
      method: 'GET',
      path: service.path
    }, null)
    expect(published).toMatchObject({
      created: true,
      revision: { sequence: 3 }
    })

    catalog = await platformEndpointCatalogService.list()
    expect(catalog.services
      .find(entry => entry.upstream.id === service.upstream.id)
      ?.endpoints[0]).toMatchObject({ status: 'live' })
  })

  it('rolls back a default domain that would collide with an explicit Host', async () => {
    const pinned = await createRoutingGraph({
      productSlug: 'pinned-host',
      hosts: ['api.example.com'],
      pathPattern: '/v1/collision',
      upstreamPathTemplate: '/healthz'
    })
    const fallback = await createRoutingGraph({
      productSlug: 'fallback-host',
      pathPattern: '/v1/collision',
      upstreamPathTemplate: '/healthz'
    })
    const revision = await routingRevisionService.publish(null)
    expect(revision.configPayload.routes.map(route => route.id).sort())
      .toEqual([pinned.route.id, fallback.route.id].sort())

    // Adopting the pinned Host as the default domain would put both Routes on
    // the same (host, method, path), so the domain change must not survive.
    await expect(platformRuntimeService.updateDefaultDomain(
      'api.example.com',
      null
    )).rejects.toMatchObject({
      statusCode: 409,
      data: { code: 'REVISION_ROUTE_CONFLICT' }
    })

    const [runtime] = await database.select().from(schema.platformRuntime)
    expect(runtime?.defaultDomain).toBeNull()
    expect(runtime?.activeRevisionId).toBe(revision.id)
    expect(await database.select().from(schema.routingRevisions)).toHaveLength(1)
  })
})
