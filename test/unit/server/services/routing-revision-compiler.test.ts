import { describe, expect, it } from 'vitest'
import { compileRoutingRevision } from '~~/server/services/routing-revision-compiler'
import type { RoutingPublicationScope, RoutingRevisionPayload } from '~~/server/types/routing-revision'

type Source = Parameters<typeof compileRoutingRevision>[0]

function route(id: string, upstream = 'upstream'): Source['routeRows'][number] {
  const timestamp = new Date('2026-01-01T00:00:00Z')
  return {
    product: {
      id: `${upstream}-product`, slug: upstream, name: upstream, summary: '', description: '',
      categoryId: null, visibility: 'public', lifecycle: 'active', deletedAt: null,
      createdAt: timestamp, updatedAt: timestamp
    },
    version: {
      id: `${upstream}-version`, productId: `${upstream}-product`, version: 'v1', state: 'published',
      openapiDocumentId: null, changelog: '', createdAt: timestamp, publishedAt: timestamp,
      deprecatedAt: null, retiredAt: null
    },
    route: {
      id, apiVersionId: `${upstream}-version`, name: id, hosts: [], method: 'GET',
      pathPattern: `/v1/${id}`, normalizedShape: `/v1/${id}`, upstreamServiceId: upstream,
      upstreamPathTemplate: `/v1/${id}`, isApiKey: true, isStatistics: true, creditsCost: 2,
      rateLimitPerSecond: 0, rateLimitPerMinute: 0, rateLimitPerHour: 0, rateLimitPerDay: 0,
      timeoutMs: 5000, maxRequestBytes: 0, maxResponseBytes: 1024,
      catalogStatus: 'automatic', sensitiveQueryParameters: [], isSupportRoute: false,
      state: 'active', deletedAt: null, createdAt: timestamp, updatedAt: timestamp
    },
    openapiDocumentId: null
  }
}

function source(rows: Source['routeRows']): Source {
  const upstreams = [...new Set(rows.map(row => row.route.upstreamServiceId))]
  return {
    routeRows: rows,
    products: rows.map(row => row.product),
    versions: rows.map(row => row.version),
    currentUpstreams: upstreams.map(id => ({ id, status: 'active', loadBalancing: 'round_robin' })),
    contracts: [],
    targetRows: upstreams.flatMap(upstreamServiceId => [1, 2].map(index => ({
      id: `${upstreamServiceId}-${index}`, upstreamServiceId, baseUrl: `https://target-${index}.example.test`,
      weight: 1, enabled: true, configurationRevision: 1, configurationHash: 'verified',
      configurationStatus: 'synced', configurationState: {}
    }))),
    connectionRows: upstreams.map(upstreamServiceId => ({ upstreamServiceId, configurationRevision: 1, configurationHash: 'verified' }))
  }
}

function revision(input: Source): RoutingRevisionPayload {
  return {
    ...compileRoutingRevision(input, null, { kind: 'all' }, null),
    revisionId: 'previous', generatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function freeze(value: unknown): void {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  Object.freeze(value)
  for (const item of Object.values(value)) freeze(item)
}

describe('complete Routing Revision compilation', () => {
  it.each([
    [{ kind: 'all' }, [['a', 9], ['b', 2]]],
    [{ kind: 'applied' }, [['a', 2]]],
    [{ kind: 'routes', routeIds: ['a'] }, [['a', 9]]]
  ] satisfies [RoutingPublicationScope, [string, number][]][])('compiles %j without changing the source or previous revision', (scope, expected) => {
    const existing = route('a')
    const previous = revision(source([existing]))
    existing.route.creditsCost = 9
    const input = source([route('b', 'other-upstream'), existing])
    const before = JSON.stringify({ input, previous })
    freeze(input)
    freeze(previous)
    const result = compileRoutingRevision(input, previous, scope, 'api.example.test')
    expect(result.routes.map(item => [item.id, item.creditsCost])).toEqual(expected)
    expect(result.defaultDomain).toBe('api.example.test')
    expect(JSON.stringify({ input, previous })).toBe(before)
  })

  it('combines applied support, current governance and verified fallback without applying a pending disable', () => {
    const publicRoute = route('player')
    publicRoute.openapiDocumentId = 'contract'
    publicRoute.route.hosts = ['api.example.test']
    const support = route('player-asset')
    support.openapiDocumentId = 'contract'
    Object.assign(support.route, { isSupportRoute: true, isApiKey: false, isStatistics: false, creditsCost: 0 })
    const input = source([publicRoute, support])
    input.contracts = [{ id: 'contract', endpoints: [{
      method: 'GET', path: '/v1/player-asset', operationId: null, summary: null,
      tags: ['player'], system: false, support: true
    }] }]
    const previous = revision(input)
    publicRoute.route.state = 'disabled'
    publicRoute.route.hosts = ['pending.example.test']
    publicRoute.route.creditsCost = 99
    input.products = input.products.map(product => ({ ...product, visibility: 'private' }))
    input.targetRows = input.targetRows.map((target, index) => ({
      ...target, enabled: index === 0, configurationStatus: 'error', baseUrl: 'https://unverified.example.test'
    }))
    freeze(input)
    freeze(previous)
    const compiled = compileRoutingRevision(input, previous, { kind: 'applied' }, null)
    expect(compiled.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'player', hosts: ['api.example.test'], creditsCost: 2, productVisibility: 'private' }),
      expect.objectContaining({ id: 'player-asset', hosts: ['api.example.test'], isSupportRoute: true })
    ]))
    expect(compiled.upstreams[0]!.targets).toEqual([previous.upstreams[0]!.targets[0]])
    expect(compiled.upstreams[0]!.targets[0]!.baseUrl).toBe('https://target-1.example.test')
  })

  it('is deterministic across source ordering and retains a legacy applied baseline', () => {
    const input = source([route('b', 'second'), route('a')])
    const previous = revision(input)
    delete previous.appliedRoutes
    const reordered: Source = {
      ...input, routeRows: [...input.routeRows].reverse(), currentUpstreams: [...input.currentUpstreams].reverse(),
      targetRows: [...input.targetRows].reverse(), connectionRows: [...input.connectionRows].reverse()
    }
    freeze(previous)
    expect(compileRoutingRevision(reordered, previous, { kind: 'applied' }, null))
      .toEqual(compileRoutingRevision(input, previous, { kind: 'applied' }, null))
    expect(previous.appliedRoutes).toBeUndefined()
  })

  it('keeps a newly applied Route in appliedRoutes until a Target is verified', () => {
    const input = source([route('waiting')])
    input.targetRows = input.targetRows.map(target => ({ ...target, configurationState: null }))
    const waiting = compileRoutingRevision(input, null, { kind: 'all' }, null)
    expect(waiting.routes).toEqual([])
    expect(waiting.appliedRoutes.map(item => item.id)).toEqual(['waiting'])
    input.targetRows = input.targetRows.map(target => ({ ...target, configurationState: {} }))
    const previous = { ...waiting, revisionId: 'waiting', generatedAt: '2026-01-01T00:00:00.000Z' }
    expect(compileRoutingRevision(input, previous, { kind: 'applied' }, null).routes.map(item => item.id)).toEqual(['waiting'])
  })
})
