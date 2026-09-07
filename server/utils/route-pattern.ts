const PARAMETER_SEGMENT_PATTERN = /^\{([A-Za-z][A-Za-z0-9_]*)(\+)?\}$/
const UPSTREAM_PARAMETER_PATTERN = /\{path\.([A-Za-z][A-Za-z0-9_]*)\}/g
const RESERVED_PLATFORM_PREFIXES = [
  '/api',
  '/_i18n',
  '/_nuxt',
  '/fonts',
  '/admin',
  '/user',
  '/login',
  '/register',
  '/oauth',
  '/verify-email',
  '/confirm-email-change',
  '/forgot-password',
  '/reset-password',
  '/callback',
  '/docs',
  '/stats',
  '/friend-links'
] as const
const RESERVED_PLATFORM_EXACT_PATHS = new Set([
  '/',
  '/favicon.ico',
  '/robots.txt'
])

export interface ParsedRoutePattern {
  pathPattern: string
  normalizedShape: string
  parameterNames: string[]
  catchAllParameter: string | null
  pattern: RegExp
  specificity: number
}

export interface RoutePatternMatch {
  params: Record<string, string>
}

/**
 * Dot path segments are meaningful to URL parsers: assigning `/a/../b` to a
 * URL pathname normalizes it to `/b`.  Route patterns and user supplied
 * parameters must never be allowed to smuggle such a segment into an
 * upstream path, otherwise an upstream base path can be escaped.
 */
function isDotPathSegment(value: string): boolean {
  let decoded = value
  // Decode at most twice.  The first pass handles normal encoded route
  // parameters (`%2e%2e`); the second catches a value that was encoded once
  // before it reached the gateway (`%252e%252e`).
  for (let index = 0; index < 2; index += 1) {
    if (decoded.split(/[\\/]/).some(segment => segment === '.' || segment === '..')) {
      return true
    }
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded.split(/[\\/]/).some(segment => segment === '.' || segment === '..')
}

export function containsDotPathSegment(value: string): boolean {
  return value.split('/').some(isDotPathSegment)
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeRoutePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) throw new Error('route path must start with /')
  if (trimmed.includes('?') || trimmed.includes('#')) throw new Error('route path must not contain query or fragment')
  if (/\s/.test(trimmed)) throw new Error('route path must not contain whitespace')
  if (trimmed.split('/').some(isDotPathSegment)) {
    throw new Error('route path must not contain dot segments')
  }
  if (trimmed.length > 1 && trimmed.endsWith('/')) return trimmed.slice(0, -1)
  return trimmed
}

export function isReservedPlatformPath(pathname: string): boolean {
  let normalized: string
  try {
    normalized = normalizeRoutePath(pathname)
  } catch {
    // Invalid/unsafe path syntax must never match a dynamic Route. Returning
    // false lets the middleware produce its normal JSON 404 contract; route
    // matching itself also treats the path as a non-match.
    return false
  }
  return RESERVED_PLATFORM_EXACT_PATHS.has(normalized)
    || RESERVED_PLATFORM_PREFIXES.some(prefix => normalized === prefix || normalized.startsWith(`${prefix}/`))
}

export function parseRoutePathPattern(value: string): ParsedRoutePattern {
  const pathPattern = normalizeRoutePath(value)
  if (pathPattern === '/') {
    return {
      pathPattern,
      normalizedShape: '/',
      parameterNames: [],
      catchAllParameter: null,
      pattern: /^\/$/,
      specificity: 1_000
    }
  }

  const names = new Set<string>()
  const parameterNames: string[] = []
  const regexSegments: string[] = []
  const shapeSegments: string[] = []
  let catchAllParameter: string | null = null
  let staticSegments = 0
  let parameterSegments = 0

  const segments = pathPattern.slice(1).split('/')
  for (const [index, segment] of segments.entries()) {
    if (!segment) throw new Error('route path must not contain empty segments')
    const parameter = PARAMETER_SEGMENT_PATTERN.exec(segment)
    if (!parameter) {
      if (segment.includes('{') || segment.includes('}')) throw new Error('route parameters must occupy a complete path segment')
      regexSegments.push(escapeRegex(segment))
      shapeSegments.push(segment)
      staticSegments += 1
      continue
    }

    const name = parameter[1]!
    const isCatchAll = Boolean(parameter[2])
    if (names.has(name)) throw new Error(`duplicate route parameter: ${name}`)
    if (isCatchAll && index !== segments.length - 1) throw new Error('catch-all route parameter must be the final segment')

    names.add(name)
    parameterNames.push(name)
    parameterSegments += 1
    regexSegments.push(isCatchAll ? '(.+)' : '([^/]+)')
    shapeSegments.push(isCatchAll ? '{+}' : '{}')
    if (isCatchAll) catchAllParameter = name
  }

  return {
    pathPattern,
    normalizedShape: `/${shapeSegments.join('/')}`,
    parameterNames,
    catchAllParameter,
    pattern: new RegExp(`^/${regexSegments.join('/')}$`),
    specificity: staticSegments * 1_000 + segments.length * 10 - parameterSegments - (catchAllParameter ? 100 : 0)
  }
}

export function matchRoutePath(parsed: ParsedRoutePattern, pathname: string): RoutePatternMatch | null {
  let normalizedPath: string
  try {
    normalizedPath = normalizeRoutePath(pathname)
  } catch {
    // A malformed or unsafe incoming URL is simply not a route match.  The
    // caller can then return the normal public 404 contract instead of
    // turning untrusted path syntax into a server error.
    return null
  }
  const match = parsed.pattern.exec(normalizedPath)
  if (!match) return null

  const params: Record<string, string> = {}
  for (const [index, name] of parsed.parameterNames.entries()) {
    try {
      params[name] = decodeURIComponent(match[index + 1]!)
    } catch {
      return null
    }
    if (
      parsed.catchAllParameter !== name
      && params[name]!.includes('/')
    ) return null
    if (containsDotPathSegment(params[name]!)) return null
  }
  return { params }
}

export function validateUpstreamPathTemplate(template: string, availableParameters: readonly string[]): string {
  const normalized = normalizeRoutePath(template)
  const allowed = new Set(availableParameters)
  for (const match of normalized.matchAll(UPSTREAM_PARAMETER_PATTERN)) {
    if (!allowed.has(match[1]!)) throw new Error(`unknown upstream path parameter: ${match[1]}`)
  }
  const withoutKnownParameters = normalized.replace(UPSTREAM_PARAMETER_PATTERN, '')
  if (withoutKnownParameters.includes('{') || withoutKnownParameters.includes('}')) {
    throw new Error('upstream path template contains an unsupported expression')
  }
  return normalized
}

export function renderUpstreamPath(template: string, params: Readonly<Record<string, string>>): string {
  const normalizedTemplate = normalizeRoutePath(template)
  return normalizedTemplate.replace(UPSTREAM_PARAMETER_PATTERN, (_value, name: string) => {
    const raw = params[name]
    if (raw === undefined) throw new Error(`missing upstream path parameter: ${name}`)
    if (containsDotPathSegment(raw)) {
      throw new Error('upstream path parameter must not contain dot segments')
    }
    return raw.split('/').map(segment => encodeURIComponent(segment)).join('/')
  })
}

export function normalizeRouteHost(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '')
  if (!normalized) throw new Error('route host is required')
  const hostname = normalized.startsWith('*.') ? normalized.slice(2) : normalized
  if (!hostname || hostname.includes('/') || hostname.includes(':') || /\s/.test(hostname)) {
    throw new Error('route host is invalid')
  }
  return normalized.startsWith('*.') ? `*.${hostname}` : hostname
}

export function routeHostMatches(configuredHost: string, requestHost: string): boolean {
  const configured = normalizeRouteHost(configuredHost)
  const incoming = requestHost.trim().toLowerCase().replace(/\.$/, '')
  if (configured.startsWith('*.')) {
    const suffix = configured.slice(1)
    return incoming.endsWith(suffix) && incoming.length > suffix.length
  }
  return configured === incoming
}
