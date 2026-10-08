import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '~~/server/db/client'
import * as schema from '~~/server/db/schema'
import type { ServiceConfigurationDefinition, ServiceDescription } from '#shared/types/service-control'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { calculateServiceConfigurationHash } from '~~/server/utils/service-configuration-values'
import { createTestDatabase } from '../../../helpers/database'
import { createPostgresTestDatabase } from '../../../helpers/postgres-database'

const context = vi.hoisted(() => ({ database: null as unknown }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
const { platformServiceControlService } = await import('~~/server/services/platform-service-control-service')
const { platformUpstreamService } = await import('~~/server/services/platform-upstream-service')
const { platformEndpointService } = await import('~~/server/services/platform-endpoint-service')
const { platformRuntimeService } = await import('~~/server/services/platform-runtime-service')
const { routingRevisionService } = await import('~~/server/services/routing-revision-service')
const { closeSafeFetchTransports } = await import('~~/server/utils/safe-fetch')

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

function fingerprint(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

const publicPath = '/v1/player'
const supportPath = '/v1/player/assets/{id}'
const token = 'upstream-concurrency-test-token-at-least-32-characters'

function contract(withSupport = false) {
  const definition: ServiceConfigurationDefinition = { schemaVersion: 1, groups: [] }
  const operation = { tags: ['Player'], responses: { 200: { description: 'OK' } } }
  const document = {
    openapi: '3.1.0', info: { title: 'Deletion test', version: '1' },
    paths: {
      [publicPath]: { get: { ...operation, operationId: 'player' } },
      ...(withSupport ? { [supportPath]: { get: {
        ...operation, operationId: 'asset', 'x-openapi-platform': { support: true }
      } } } : {})
    }
  }
  const description: ServiceDescription = {
    schemaVersion: 1, serviceProtocol: 'openapi-service/v1', serviceId: 'deletion-test',
    name: 'Deletion test', version: withSupport ? '2' : '1', commit: 'test',
    openapi: '/openapi.json', openapiSha256: fingerprint(document), health: '/healthz', readiness: '/readyz',
    configuration: { schema: '/schema', state: '/state', update: '/configuration', schemaSha256: fingerprint(definition) }
  }
  const state = {
    schemaVersion: 1, serviceId: description.serviceId, schemaSha256: description.configuration.schemaSha256,
    revision: 0, configurationSha256: calculateServiceConfigurationHash(description.configuration.schemaSha256, {}),
    values: {}, updatedAt: null
  }
  return { description, definition, document, state }
}

let fixture = contract()
let openApiGate: { entered: ReturnType<typeof deferred>, release: ReturnType<typeof deferred>, fail: boolean } | undefined
const server = createServer((req, res) => {
  void (async () => {
    if (req.url !== '/readyz' && req.headers.authorization !== `Service ${token}`) {
      res.writeHead(401).end()
      return
    }
    const observed = fixture
    res.setHeader('content-type', 'application/json')
    switch (req.url) {
      case '/.well-known/service.json':
        res.setHeader('x-openapi-sha256', observed.description.openapiSha256)
        res.end(JSON.stringify(observed.description)); return
      case '/schema':
        res.setHeader('x-configuration-schema-sha256', observed.description.configuration.schemaSha256)
        res.end(JSON.stringify(observed.definition)); return
      case '/state': res.end(JSON.stringify(observed.state)); return
      case '/openapi.json': {
        const gate = openApiGate
        if (gate) { gate.entered.resolve(); await gate.release.promise }
        if (gate?.fail) { res.writeHead(503).end('{}'); return }
        res.setHeader('x-openapi-sha256', observed.description.openapiSha256)
        res.end(JSON.stringify(observed.document)); return
      }
      case '/readyz': res.end('{}'); return
      default: res.writeHead(404).end()
    }
  })().catch(() => res.destroy())
})

const postgresUrl = process.env.TEST_POSTGRES_URL
let postgresDatabase: Awaited<ReturnType<typeof createPostgresTestDatabase>> | undefined
let pgliteDatabase: Awaited<ReturnType<typeof createTestDatabase>> | undefined
let database: Database
let baseUrl: string

beforeAll(async () => {
  if (postgresUrl) {
    postgresDatabase = await createPostgresTestDatabase(postgresUrl)
    database = postgresDatabase.database
  } else {
    pgliteDatabase = await createTestDatabase()
    database = pgliteDatabase.database as unknown as Database
  }
  context.database = database
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

beforeEach(async () => {
  vi.stubGlobal('useRuntimeConfig', () => ({ apiKeySecret: '0123456789abcdef0123456789abcdef', redis: { url: '' } }))
  fixture = contract()
  openApiGate = undefined
  await database.execute(sql`TRUNCATE platform_runtime, routing_revisions, api_products, upstream_services, openapi_documents CASCADE`)
  await platformRuntimeService.ensureDefault()
})
afterEach(() => { openApiGate?.release.resolve(); vi.unstubAllGlobals() })
afterAll(async () => {
  await closeSafeFetchTransports()
  if (server.listening) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })
  await postgresDatabase?.close()
  await pgliteDatabase?.client.close()
})

async function pendingUpstream() {
  const upstream = await platformUpstreamService.create({
    slug: 'deletion-test', name: 'Deletion test', loadBalancing: 'round_robin', serviceToken: token,
    targets: [{ baseUrl, weight: 1 }]
  })
  await platformServiceControlService.discover(upstream.id)
  await platformEndpointService.publish({ upstreamServiceId: upstream.id, method: 'GET', path: publicPath }, null, { publishRouting: false })
  return upstream
}

async function payload() {
  const runtime = await platformRuntimeService.get()
  const [revision] = await database.select().from(schema.routingRevisions).where(eq(schema.routingRevisions.id, runtime.activeRevisionId!))
  return revision!.configPayload
}

async function expectRemoved(id: string, routeCount: number) {
  expect(await platformUpstreamService.findById(id)).toMatchObject({ deletedAt: expect.any(Date), status: 'disabled' })
  const routes = await database.select().from(schema.apiRoutes).where(eq(schema.apiRoutes.upstreamServiceId, id))
  expect(routes).toHaveLength(routeCount)
  expect(routes.every(route => route.deletedAt !== null && route.state === 'disabled')).toBe(true)
  expect((await platformEndpointService.list()).services).toEqual([])
  const current = await payload()
  expect(current.upstreams).toEqual([])
  expect(current.routes).toEqual([])
  expect(current.appliedRoutes).toEqual([])
}

describe('Upstream deletion through discovery and publication interfaces', () => {
  it.each([false, true])('does not accept late discovery writes after deletion (network failure = %s)', async (fail) => {
    const upstream = await pendingUpstream()
    fixture = contract(true)
    const gate = { entered: deferred(), release: deferred(), fail }
    openApiGate = gate
    const discovery = platformServiceControlService.discover(upstream.id).then(value => ({ value }), error => ({ error }))
    try {
      await gate.entered.promise
      await platformUpstreamService.removeAndPublish(upstream.id, null)
      const connections = await database.select().from(schema.upstreamServiceConnections)
      const targets = await database.select().from(schema.upstreamTargets)
      const documents = await database.select().from(schema.openapiDocuments)
      const runtime = await payload()
      gate.release.resolve()
      expect(await discovery).toMatchObject({ error: fail
        ? { name: 'ServiceControlRequestError', status: 503, endpoint: '/openapi.json' }
        : { data: { code: 'SERVICE_DISCOVERY_CONFLICT' } } })
      expect(await database.select().from(schema.upstreamServiceConnections)).toEqual(connections)
      expect(await database.select().from(schema.upstreamTargets)).toEqual(targets)
      expect(await database.select().from(schema.openapiDocuments)).toEqual(documents)
      expect(await payload()).toEqual(runtime)
      await expectRemoved(upstream.id, 1)
    } finally {
      gate.release.resolve()
      await discovery
    }
  })

  it('cleans up support Routes committed by a completed discovery', async () => {
    const upstream = await pendingUpstream()
    fixture = contract(true)
    await platformServiceControlService.discover(upstream.id)
    const routes = await database.select().from(schema.apiRoutes)
    expect(routes.find(route => route.isSupportRoute)).toMatchObject({ pathPattern: supportPath, deletedAt: null })
    await platformUpstreamService.removeAndPublish(upstream.id, null)
    await expectRemoved(upstream.id, 2)
  })
})

// These gates live only in the disposable PostgreSQL database. They pause a
// real write while the production transaction still owns all preceding locks.
async function holdWrite(table: 'api_routes' | 'routing_revisions' | 'upstream_services', event: 'INSERT' | 'UPDATE', condition: string) {
  const client = postgresDatabase!.client
  const gate = await client.reserve()
  const [{ pid }] = await gate<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
  await gate`SELECT pg_advisory_lock(742901)`
  await client.unsafe(`CREATE FUNCTION pause_upstream_test_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_advisory_xact_lock(742901); RETURN NEW; END $$`)
  await client.unsafe(`CREATE TRIGGER pause_upstream_test_write BEFORE ${event} ON ${table}
    FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION pause_upstream_test_write()`)
  let released = false
  return {
    pid: pid!,
    async release() {
      if (released) return
      await gate`SELECT pg_advisory_unlock(742901)`
      released = true
    },
    async close() {
      try {
        await client.unsafe(`DROP TRIGGER pause_upstream_test_write ON ${table}`)
        await client.unsafe('DROP FUNCTION pause_upstream_test_write()')
      } finally {
        await gate.release()
      }
    }
  }
}

async function blockedBy(blocker: number) {
  let waiter = 0
  await vi.waitFor(async () => {
    const rows = await postgresDatabase!.client<{ pid: number }[]>`
      SELECT pid FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND ${blocker} = ANY(pg_blocking_pids(pid))`
    expect(rows).toHaveLength(1)
    waiter = rows[0]!.pid
  }, { timeout: 5000, interval: 20 })
  return waiter
}

describe.skipIf(!postgresUrl)('PostgreSQL connections serialize Upstream deletion', () => {
  it('waits for discovery to commit and removes the support Route it created', async () => {
    const upstream = await pendingUpstream()
    fixture = contract(true)
    const gate = await holdWrite('api_routes', 'INSERT', 'NEW.is_support_route')
    const discovery = platformServiceControlService.discover(upstream.id)
    let deletion: ReturnType<typeof platformUpstreamService.removeAndPublish> | undefined
    try {
      const discovering = await blockedBy(gate.pid)
      deletion = platformUpstreamService.removeAndPublish(upstream.id, null)
      await blockedBy(discovering)
      await gate.release()
      await Promise.all([discovery, deletion])
      await expectRemoved(upstream.id, 2)
    } finally {
      await gate.release()
      await Promise.allSettled([discovery, deletion])
      await gate.close()
    }
  })

  it.each(['publish', 'delete'] as const)('protects the committed result when %s takes the Runtime lock first', async (first) => {
    const upstream = await pendingUpstream()
    const gate = first === 'publish'
      ? await holdWrite('routing_revisions', 'INSERT', 'true')
      : await holdWrite('upstream_services', 'UPDATE', 'NEW.deleted_at IS NOT NULL')
    const publish = () => routingRevisionService.publish(null)
    const remove = () => platformUpstreamService.removeAndPublish(upstream.id, null)
    const leading = first === 'publish' ? publish() : remove()
    let following: Promise<unknown> | undefined
    try {
      const leader = await blockedBy(gate.pid)
      following = (first === 'publish' ? remove() : publish()).then(value => ({ value }), error => ({ error }))
      await blockedBy(leader)
      await gate.release()
      await leading
      const outcome = await following
      if (first === 'publish') {
        expect(outcome).toMatchObject({ error: { data: { code: 'UPSTREAM_STILL_PUBLISHED' } } })
        expect((await payload()).upstreams.map(item => item.id)).toEqual([upstream.id])
        expect((await payload()).routes).toHaveLength(1)
        expect((await platformUpstreamService.findById(upstream.id))?.deletedAt).toBeNull()
        expect((await database.select().from(schema.apiRoutes)).every(route => route.deletedAt === null)).toBe(true)
      } else {
        expect(outcome).toHaveProperty('value')
        await expectRemoved(upstream.id, 1)
      }
    } finally {
      await gate.release()
      await Promise.allSettled([leading, following])
      await gate.close()
    }
  })
})
