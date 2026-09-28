// Platform-managed headers that upstreams must not be able to overwrite.
// These are set by the gateway's access control, correlation, and metadata layers.
const PLATFORM_MANAGED_HEADERS = new Set([
  'retry-after',
  'x-request-id',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-window',
  'forwarded',
  'via',
  'x-real-ip',
  'x-openapi-route-id',
  'x-openapi-upstream-id',
  'x-openapi-revision-id',
  'x-openapi-product-id',
  'x-openapi-product-slug',
  'x-openapi-api-version'
])

const BLOCKED_RESPONSE_HEADERS = new Set([
  'clear-site-data',
  'connection',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'keep-alive',
  'origin-agent-cluster',
  'permissions-policy',
  'proxy-authenticate',
  'proxy-authorization',
  'referrer-policy',
  'service-worker-allowed',
  'set-cookie',
  'set-cookie2',
  'strict-transport-security',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-content-type-options',
  'x-frame-options',
  'x-permitted-cross-domain-policies'
])

export function sanitizeGatewayResponseHeaders(
  source: Headers,
  allowCaching = true
): Headers {
  const headers = new Headers()
  for (const [name, value] of source) {
    const normalized = name.toLowerCase()
    if (
      BLOCKED_RESPONSE_HEADERS.has(normalized)
      || PLATFORM_MANAGED_HEADERS.has(normalized)
      || normalized.startsWith('x-forwarded-')
      || normalized.startsWith('x-ratelimit-')
    ) continue
    if (normalized.startsWith('access-control-')) continue
    if (!allowCaching && (
      normalized === 'cache-control'
      || normalized.endsWith('-cache-control')
      || normalized === 'surrogate-control'
      || normalized === 'expires'
      || normalized === 'age'
    )) continue
    headers.append(name, value)
  }
  if (!allowCaching) {
    headers.set('cache-control', 'private, no-store')
    headers.set('cdn-cache-control', 'no-store')
    headers.set('surrogate-control', 'no-store')
  }
  return headers
}
