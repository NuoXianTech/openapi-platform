import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readServiceTargetContract } from '~~/server/services/service-target-contract'
import { canonicalJson } from '~~/server/utils/canonical-json'

const transport = vi.hoisted(() => vi.fn())
vi.mock('~~/server/utils/upstream-target-fetch', () => ({ fetchUpstreamTarget: transport }))

function contract() {
  const definition = { schemaVersion: 1, groups: [] }
  const schemaSha256 = createHash('sha256').update(canonicalJson(definition)).digest('hex')
  const description = {
    schemaVersion: 1, serviceProtocol: 'openapi-service/v1', serviceId: 'contract-test',
    name: 'Contract', version: '1', commit: 'test', openapi: '/openapi.json',
    openapiSha256: 'a'.repeat(64), health: '/healthz', readiness: '/readyz',
    configuration: { schema: '/schema', state: '/state', update: '/configuration', schemaSha256 }
  }
  const state = {
    schemaVersion: 1, serviceId: description.serviceId, schemaSha256, revision: 1,
    configurationSha256: 'b'.repeat(64), values: {}, updatedAt: '2026-10-02T00:00:00.000Z'
  }
  return { description, definition, state,
    descriptionHeaders: new Headers({ 'x-openapi-sha256': description.openapiSha256 }),
    definitionHeaders: new Headers({ 'x-configuration-schema-sha256': schemaSha256 }) }
}

function serve(fixture: ReturnType<typeof contract>) {
  transport.mockImplementation(async (url: URL) => {
    switch (url.pathname) {
      case '/target/.well-known/service.json':
        return Response.json(fixture.description, { headers: fixture.descriptionHeaders })
      case '/target/schema':
        return Response.json(fixture.definition, { headers: fixture.definitionHeaders })
      case '/target/state':
        return Response.json(fixture.state)
      default:
        throw new Error(`Unexpected request: ${url.pathname}`)
    }
  })
}

describe('Target contract read', () => {
  beforeEach(() => { transport.mockReset() })
  afterEach(() => vi.restoreAllMocks())

  it('reads a verified contract with authenticated requests under the Target base path', async () => {
    const fixture = contract()
    serve(fixture)
    await expect(readServiceTargetContract('https://target.test/target', 'test-token')).resolves.toEqual({
      description: fixture.description, definition: fixture.definition, state: fixture.state
    })
    expect(transport.mock.calls.map(([url]) => (url as URL).pathname)).toEqual([
      '/target/.well-known/service.json', '/target/schema', '/target/state'
    ])
    for (const [, init] of transport.mock.calls) {
      expect((init as RequestInit).headers).toBeInstanceOf(Headers)
      expect(new Headers((init as RequestInit).headers).get('authorization')).toBe('Service test-token')
    }
  })

  it.each(['missing description hash', 'wrong description hash', 'missing schema hash', 'wrong schema hash',
    'different schema', 'different identity', 'different state schema'])(
    'rejects %s before discovery can accept the Target', async (failure) => {
      const fixture = contract()
      if (failure === 'missing description hash') fixture.descriptionHeaders.delete('x-openapi-sha256')
      if (failure === 'wrong description hash') fixture.descriptionHeaders.set('x-openapi-sha256', 'c'.repeat(64))
      if (failure === 'missing schema hash') fixture.definitionHeaders.delete('x-configuration-schema-sha256')
      if (failure === 'wrong schema hash') fixture.definitionHeaders.set('x-configuration-schema-sha256', 'c'.repeat(64))
      if (failure === 'different schema') fixture.description.configuration.schemaSha256 = 'c'.repeat(64)
      if (failure === 'different identity') fixture.state.serviceId = 'another-target'
      if (failure === 'different state schema') fixture.state.schemaSha256 = 'c'.repeat(64)
      serve(fixture)
      await expect(readServiceTargetContract('https://target.test/target', 'test-token')).rejects.toMatchObject({
        data: { code: failure.includes('description') ? 'SERVICE_OPENAPI_HASH_MISMATCH' : 'SERVICE_CONFIGURATION_HASH_MISMATCH' }
      })
    }
  )

  it('preserves unsupported protocol errors and stops before reading configuration', async () => {
    transport.mockResolvedValue(Response.json({ serviceProtocol: 'openapi-service/v2' }))
    await expect(readServiceTargetContract('https://target.test/target', 'test-token')).rejects.toMatchObject({
      name: 'UnsupportedServiceProtocolError', serviceProtocol: 'openapi-service/v2'
    })
    expect(transport).toHaveBeenCalledOnce()
  })

  it('does not turn a failed configuration read into a verified contract', async () => {
    const fixture = contract()
    serve(fixture)
    const read = transport.getMockImplementation()!
    transport.mockImplementation((url: URL, init: RequestInit) => url.pathname.endsWith('/state')
      ? Promise.reject(new Error('Target offline')) : read(url, init))
    await expect(readServiceTargetContract('https://target.test/target', 'test-token')).rejects.toMatchObject({ name: 'ServiceControlRequestError', status: null })
  })
})
