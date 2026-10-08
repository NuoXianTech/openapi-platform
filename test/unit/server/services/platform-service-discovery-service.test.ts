import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceConfigurationDefinition, ServiceDescription, ServiceDiscoveryOutcome } from '#shared/types/service-control'
import * as schema from '~~/server/db/schema'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { calculateServiceConfigurationHash } from '~~/server/utils/service-configuration-values'
import { createTestDatabase } from '../../../helpers/database'

const context = vi.hoisted(() => ({ database: null as unknown }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
const { platformServiceControlService } = await import('~~/server/services/platform-service-control-service')
const { platformUpstreamService } = await import('~~/server/services/platform-upstream-service')
const { platformRuntimeService } = await import('~~/server/services/platform-runtime-service')
const { closeSafeFetchTransports } = await import('~~/server/utils/safe-fetch')

function fingerprint(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function contract(name: string) {
  const definition: ServiceConfigurationDefinition = {
    schemaVersion: 1, groups: [{ key: 'settings', label: 'Settings', fields: [
      { key: 'marker', type: 'text', label: 'Marker', default: name }
    ] }]
  }
  const endpoint = {
    method: 'GET', path: '/v1/' + name, operationId: name + 'Endpoint', summary: name,
    tags: ['Group'], system: false, support: false
  }
  const document = {
    openapi: '3.1.0', info: { title: 'Cohort discovery', version: name },
    paths: { [endpoint.path]: { get: {
      operationId: endpoint.operationId, summary: endpoint.summary, tags: endpoint.tags,
      responses: { 200: { description: 'OK' } }
    } } }
  }
  const description: ServiceDescription = {
    schemaVersion: 1, serviceProtocol: 'openapi-service/v1', serviceId: 'cohort-service',
    name: 'Cohort discovery', version: name, commit: name,
    openapi: '/openapi.json', openapiSha256: fingerprint(document), health: '/healthz', readiness: '/readyz',
    configuration: { schema: '/schema', state: '/state', update: '/configuration', schemaSha256: fingerprint(definition) }
  }
  const state = {
    schemaVersion: 1, serviceId: description.serviceId, schemaSha256: description.configuration.schemaSha256,
    revision: 0, configurationSha256: calculateServiceConfigurationHash(description.configuration.schemaSha256, { marker: name }),
    values: { marker: name }, updatedAt: null
  }
  return { definition, description, document, endpoint, state }
}

type Contract = ReturnType<typeof contract>
type Upstream = Awaited<ReturnType<typeof platformUpstreamService.create>>
const token = 'cohort-discovery-service-token-with-at-least-32-characters'
const targets = new Map<string, { contract: Contract, corruptOpenApi?: boolean }>()
const requests: string[] = []
// Real HTTP Targets exercise parsing, fingerprints, selection and persistence together.
const service = createServer((req, res) => {
  const [, targetName, ...segments] = req.url!.split('/')
  const endpoint = '/' + segments.join('/')
  const target = targets.get(targetName!)
  requests.push(req.url!)
  if (!target) { res.statusCode = 404; res.end(); return }
  if (endpoint !== '/readyz' && req.headers.authorization !== 'Service ' + token) {
    res.statusCode = 401; res.end(); return
  }
  const fixture = target.contract
  res.setHeader('content-type', 'application/json')
  switch (endpoint) {
    case '/.well-known/service.json':
      res.setHeader('x-openapi-sha256', fixture.description.openapiSha256)
      res.end(JSON.stringify(fixture.description))
      return
    case '/schema':
      res.setHeader('x-configuration-schema-sha256', fixture.description.configuration.schemaSha256)
      res.end(JSON.stringify(fixture.definition))
      return
    case '/state': res.end(JSON.stringify(fixture.state)); return
    case '/openapi.json':
      res.setHeader('x-openapi-sha256', target.corruptOpenApi ? '0'.repeat(64) : fixture.description.openapiSha256)
      res.end(JSON.stringify(fixture.document))
      return
    case '/readyz': res.end('{}'); return
    default: res.statusCode = 404; res.end()
  }
})
let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>
let baseUrl: string

beforeAll(async () => {
  testDatabase = await createTestDatabase()
  context.database = testDatabase.database
  await new Promise<void>(resolve => service.listen(0, '127.0.0.1', resolve))
  baseUrl = 'http://127.0.0.1:' + (service.address() as { port: number }).port
})
beforeEach(async () => {
  vi.stubGlobal('useRuntimeConfig', () => ({ apiKeySecret: '0123456789abcdef0123456789abcdef', redis: { url: '' } }))
  targets.clear()
  requests.length = 0
  await testDatabase.client.exec('TRUNCATE platform_runtime, routing_revisions, api_products, upstream_services, openapi_documents CASCADE')
  await platformRuntimeService.ensureDefault()
})
afterEach(() => vi.unstubAllGlobals())
afterAll(async () => {
  await closeSafeFetchTransports()
  await new Promise<void>(resolve => { service.closeAllConnections(); service.close(() => resolve()) })
  await testDatabase.client.close()
})

function createUpstream(slug: string, names: string[]) {
  return platformUpstreamService.create({
    slug, name: slug, serviceToken: token, loadBalancing: 'round_robin',
    targets: names.map(name => ({ baseUrl: baseUrl + '/' + name, weight: 1 }))
  })
}
function openApiRequests() {
  return requests.filter(path => path.endsWith('/openapi.json'))
}

async function expectSelectedContract(upstream: Upstream, result: ServiceDiscoveryOutcome, selected: Contract, names: string[]) {
  const chosenTargets = upstream.targets.filter(target => names.some(name => target.baseUrl === baseUrl + '/' + name))
    .sort((left, right) => left.id.localeCompare(right.id))
  const sourceUrl = chosenTargets[0]!.baseUrl + '/openapi.json'
  expect(openApiRequests()).toEqual([new URL(sourceUrl).pathname])
  expect(result.connection).toMatchObject({
    discovered: true, serviceVersion: selected.description.version,
    openapiSha256: selected.description.openapiSha256,
    configurationSchemaSha256: selected.description.configuration.schemaSha256
  })
  expect(result.definition).toEqual(selected.definition)
  expect(result.endpoints).toEqual([selected.endpoint])
  expect(result.values).toEqual(selected.state.values)
  expect(result.routingStatus).toBe('applied')
  expect(result.routingRevision).not.toBeNull()
  expect((await platformRuntimeService.get()).activeRevisionId).toBe(result.routingRevision!.id)

  const db = testDatabase.database
  const [connection] = await db.select().from(schema.upstreamServiceConnections)
    .where(eq(schema.upstreamServiceConnections.upstreamServiceId, upstream.id))
  expect(connection).toMatchObject({ serviceDescription: selected.description, configurationSchema: selected.definition })
  const [stored] = await db.select({ document: schema.openapiDocuments }).from(schema.upstreamServices)
    .innerJoin(schema.openapiDocuments, eq(schema.openapiDocuments.id, schema.upstreamServices.openapiDocumentId))
    .where(eq(schema.upstreamServices.id, upstream.id))
  expect(stored!.document).toMatchObject({ content: selected.document, contentHash: selected.description.openapiSha256, sourceUrl })
  const storedTargets = await db.select().from(schema.upstreamTargets).where(eq(schema.upstreamTargets.upstreamServiceId, upstream.id))
  expect(result.targets).toHaveLength(upstream.targets.length)
  for (const target of storedTargets) {
    const accepted = chosenTargets.some(chosen => chosen.id === target.id)
    const expected = accepted
      ? { configurationStatus: 'unknown', configurationState: selected.state, lastError: null }
      : { configurationStatus: 'error', lastError: 'upstream Target exposes a different Service contract' }
    expect(target).toMatchObject(expected)
    expect(result.targets.find(item => item.id === target.id)).toMatchObject(expected)
  }
  if (chosenTargets.length < upstream.targets.length) {
    expect(result.connection.lastDiscoveryError).toContain('different Service contract')
  } else expect(result.connection.lastDiscoveryError).toBeNull()
}

describe('Service discovery contract selection through the complete interface', () => {
  it('keeps the current contract while one compatible Target remains against a newer majority', async () => {
    const current = contract('current')
    const replacement = contract('replacement')
    for (const name of ['old', 'new-one', 'new-two']) targets.set(name, { contract: current })
    const upstream = await createUpstream('rolling-upgrade', ['new-two', 'old', 'new-one'])
    await platformServiceControlService.discover(upstream.id)

    targets.set('new-one', { contract: replacement })
    targets.set('new-two', { contract: replacement })
    requests.length = 0
    const result = await platformServiceControlService.discover(upstream.id)
    await expectSelectedContract(upstream, result, current, ['old'])
  })

  it('takes OpenAPI, configuration and accepted Target states from the largest initial cohort', async () => {
    const smaller = contract('smaller')
    const larger = contract('larger')
    targets.set('small', { contract: smaller })
    for (const name of ['large-one', 'large-two']) targets.set(name, { contract: larger })
    const upstream = await createUpstream('first-discovery', ['large-two', 'small', 'large-one'])
    const result = await platformServiceControlService.discover(upstream.id)
    await expectSelectedContract(upstream, result, larger, ['large-one', 'large-two'])
  })

  it('breaks equally sized initial cohorts consistently regardless of Target insertion order', async () => {
    const left = contract('left')
    const right = contract('right')
    targets.set('left', { contract: left })
    targets.set('right', { contract: right })
    const first = await createUpstream('tie-first', ['left', 'right'])
    const initial = await platformServiceControlService.discover(first.id)
    expect([left.description.openapiSha256, right.description.openapiSha256]).toContain(initial.connection.openapiSha256)
    const selected = initial.connection.openapiSha256 === left.description.openapiSha256 ? left : right
    await expectSelectedContract(first, initial, selected, [selected.description.version])

    const second = await createUpstream('tie-reversed', ['right', 'left'])
    requests.length = 0
    const reversed = await platformServiceControlService.discover(second.id)
    await expectSelectedContract(second, reversed, selected, [selected.description.version])
  })

  it('preserves the committed contract when selected OpenAPI is invalid instead of falling back to an incompatible cohort', async () => {
    const current = contract('current')
    for (const name of ['old', 'new-one', 'new-two']) targets.set(name, { contract: current })
    const upstream = await createUpstream('invalid-selected-document', ['old', 'new-one', 'new-two'])
    await platformServiceControlService.discover(upstream.id)
    const documents = await testDatabase.database.select().from(schema.openapiDocuments)
    const runtime = await platformRuntimeService.get()

    targets.set('old', { contract: current, corruptOpenApi: true })
    const replacement = contract('replacement')
    for (const name of ['new-one', 'new-two']) targets.set(name, { contract: replacement })
    requests.length = 0
    await expect(platformServiceControlService.discover(upstream.id))
      .rejects.toMatchObject({ data: { code: 'SERVICE_OPENAPI_HASH_MISMATCH' } })
    expect(openApiRequests()).toEqual(['/old/openapi.json'])
    expect(await testDatabase.database.select().from(schema.openapiDocuments)).toEqual(documents)
    expect(await platformRuntimeService.get()).toEqual(runtime)
    const view = await platformServiceControlService.get(upstream.id)
    expect(view.connection.openapiSha256).toBe(current.description.openapiSha256)
    expect(view.definition).toEqual(current.definition)
    expect(view.endpoints).toEqual([current.endpoint])
  })
})
