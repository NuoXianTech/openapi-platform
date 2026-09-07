import { describe, expect, it } from 'vitest'
import {
  isReservedPlatformPath,
  matchRoutePath,
  normalizeRouteHost,
  parseRoutePathPattern,
  renderUpstreamPath,
  routeHostMatches,
  validateUpstreamPathTemplate
} from '~~/server/utils/route-pattern'

describe('route pattern utilities', () => {
  it('matches OpenAPI parameters and calculates a stable shape', () => {
    const parsed = parseRoutePathPattern('/v1/users/{userId}')
    expect(parsed.normalizedShape).toBe('/v1/users/{}')
    expect(matchRoutePath(parsed, '/v1/users/a%20b')).toEqual({ params: { userId: 'a b' } })
    expect(matchRoutePath(parsed, '/v1/users')).toBeNull()
  })

  it('supports a final catch-all parameter', () => {
    const parsed = parseRoutePathPattern('/v1/files/{path+}')
    expect(parsed.normalizedShape).toBe('/v1/files/{+}')
    expect(matchRoutePath(parsed, '/v1/files/a/b.txt')).toEqual({ params: { path: 'a/b.txt' } })
    expect(() => parseRoutePathPattern('/v1/{path+}/tail')).toThrow(/final segment/)
  })

  it('validates and renders upstream templates', () => {
    const template = validateUpstreamPathTemplate('/internal/users/{path.userId}', ['userId'])
    expect(renderUpstreamPath(template, { userId: 'a b' })).toBe('/internal/users/a%20b')
    expect(() => validateUpstreamPathTemplate('/users/{path.missing}', ['userId'])).toThrow(/unknown/)
  })

  it('matches exact and wildcard hosts', () => {
    expect(normalizeRouteHost('API.Example.com.')).toBe('api.example.com')
    expect(routeHostMatches('*.example.com', 'api.example.com')).toBe(true)
    expect(routeHostMatches('*.example.com', 'example.com')).toBe(false)
    expect(routeHostMatches('api.example.com', 'api.example.com')).toBe(true)
  })

  it('protects Platform-owned paths from dynamic routes', () => {
    expect(isReservedPlatformPath('/api/admin/v1/routes')).toBe(true)
    expect(isReservedPlatformPath('/_i18n/hash/zh-CN/messages.json')).toBe(true)
    expect(isReservedPlatformPath('/fonts')).toBe(true)
    expect(isReservedPlatformPath('/fonts/inter-latin-wght-normal.woff2')).toBe(true)
    expect(isReservedPlatformPath('/admin')).toBe(true)
    expect(isReservedPlatformPath('/v1/fonts')).toBe(false)
    expect(isReservedPlatformPath('/fonts-api')).toBe(false)
    expect(isReservedPlatformPath('/v1/music')).toBe(false)
  })

  it('rejects dot segments in route patterns and decoded parameters', () => {
    expect(() => parseRoutePathPattern('/v1/../admin')).toThrow(/dot segments/)
    expect(() => parseRoutePathPattern('/v1/%2e%2e/admin')).toThrow(/dot segments/)

    const parsed = parseRoutePathPattern('/v1/files/{path+}')
    expect(matchRoutePath(parsed, '/v1/files/a/%2e%2e/secret')).toBeNull()
    expect(matchRoutePath(
      parseRoutePathPattern('/v1/users/{id}'),
      '/v1/users/a%2Fb'
    )).toBeNull()
    expect(() => renderUpstreamPath('/base/{path.path}', {
      path: '../secret'
    })).toThrow(/dot segments/)
  })
})
