import type { H3Event } from 'h3'
import {
  getProxyRequestHeaders,
  getRequestProtocol,
  getRequestURL,
  sendNoContent,
  setResponseHeader
} from 'h3'
import { dynamicGatewayAccessService } from '~~/server/services/dynamic-gateway-access-service'
import {
  routingRuntimeService,
  RoutingRuntimeUnavailableError,
  type RoutingResolution,
  type ResolvedDynamicRoute
} from '~~/server/services/routing-runtime-service'
import {
  BillingPersistenceError,
  findBillingPersistenceError,
  findGatewayExecutionError,
  GatewayExecutionError
} from '~~/server/errors/gateway-error'
import { gatewayCallService } from '~~/server/services/dynamic-gateway-call-service'
import { assertGatewayRequestSize } from '~~/server/services/dynamic-gateway-stream-service'
import { forwardGatewayRequest } from '~~/server/services/dynamic-gateway-transport'
import { getAppEventContext } from '~~/server/utils/event-context'
import { gatewayFail } from '~~/server/utils/gateway-response'
import { setPublicApiCors } from '~~/server/utils/public-api-cors'
import { ensureRequestId } from '~~/server/utils/request-id'
import { readClientIp } from '~~/server/utils/request-meta'
import { upstreamServiceTokenService } from '~~/server/services/upstream-service-token-service'

const STRIPPED_REQUEST_HEADERS = new Set([
  'authorization',
  'cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'proxy-authorization',
  // The request body is wrapped by the streaming size limiter. Let fetch
  // calculate framing instead of forwarding a caller-controlled length.
  'content-length',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'te',
  'trailer'
])

// Forwarding headers are stripped and rebuilt by the platform.
// Callers must not be able to forge x-forwarded-*, forwarded, x-real-ip, or via.
const FORWARDING_HEADER_PATTERNS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
  'via'
] as const

interface DynamicGatewayResult {
  matched: boolean
  response?: unknown
}

const UPSTREAM_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/
const UPSTREAM_RETRY_AFTER_SECONDS = 1

export function createUpstreamHeaders(event: H3Event, match: ResolvedDynamicRoute, serviceToken: string): Headers {
  const headers = new Headers(getProxyRequestHeaders(event))
  for (const name of Array.from(headers.keys())) {
    const normalized = name.toLowerCase()
    if (
      STRIPPED_REQUEST_HEADERS.has(normalized)
      || FORWARDING_HEADER_PATTERNS.some(pattern => normalized === pattern || normalized.startsWith('x-forwarded-'))
      || normalized.startsWith('x-openapi-')
    ) {
      headers.delete(name)
    }
  }

  const requestUrl = getRequestURL(event)
  const clientIp = readClientIp(event)
  headers.set('x-request-id', ensureRequestId(event))
  const publicProtocol = getAppEventContext(event).publicRequestProtocol
    ?? getRequestProtocol(event, { xForwardedProto: false })
  headers.set('x-forwarded-proto', publicProtocol)
  headers.set('x-forwarded-host', requestUrl.host)
  if (clientIp) headers.set('x-forwarded-for', clientIp)
  else headers.delete('x-forwarded-for')
  headers.set('x-openapi-route-id', match.route.id)
  headers.set('x-openapi-upstream-id', match.upstream.id)
  headers.set('x-openapi-revision-id', match.revisionId)
  headers.set('x-openapi-product-id', match.route.productId)
  headers.set('x-openapi-product-slug', match.route.productSlug)
  headers.set('x-openapi-api-version', match.route.version)

  if (!serviceToken) {
    throw new GatewayExecutionError(503, 'UPSTREAM_AUTH_UNAVAILABLE', '上游服务凭证尚未配置')
  }
  headers.set('authorization', `Service ${serviceToken}`)
  return headers
}

function captureUpstreamFailure(event: H3Event, response: Response): void {
  if (response.status < 400) return
  const errorCode = response.headers.get('x-openapi-error-code')?.trim() ?? ''
  if (!UPSTREAM_ERROR_CODE_PATTERN.test(errorCode)) return
  getAppEventContext(event).apiFailure = {
    errorCode,
    errorMessage: null
  }
}

function gatewayFailureResult(
  event: H3Event,
  status: number,
  code: string,
  message: string,
  error: unknown
): DynamicGatewayResult {
  if (code === 'UPSTREAM_UNAVAILABLE' || code === 'UPSTREAM_TIMEOUT') {
    setResponseHeader(event, 'Retry-After', UPSTREAM_RETRY_AFTER_SECONDS)
  }
  if (!event.node.res.headersSent) {
    return {
      matched: true,
      response: gatewayFail(event, status, code, message)
    }
  }
  getAppEventContext(event).apiFailure = {
    errorCode: code,
    errorMessage: message
  }
  event.node.res.statusCode = status
  event.node.res.destroy(error instanceof Error ? error : undefined)
  return { matched: true }
}

function routingRuntimeUnavailableResult(
  event: H3Event,
  error: unknown
): DynamicGatewayResult | null {
  const isUnavailable = typeof RoutingRuntimeUnavailableError === 'function'
    && error instanceof RoutingRuntimeUnavailableError
  const hasStableCode = error !== null
    && typeof error === 'object'
    && (error as { code?: unknown }).code === 'ROUTING_RUNTIME_UNAVAILABLE'
  if (!isUnavailable && !hasStableCode) return null
  const statusCode = isUnavailable
    ? error.statusCode
    : 503
  return {
    matched: true,
    response: gatewayFail(
      event,
      statusCode,
      'ROUTING_RUNTIME_UNAVAILABLE',
      '网关路由暂不可用，请稍后再试'
    )
  }
}

export const dynamicGatewayService = {
  async tryHandle(event: H3Event): Promise<DynamicGatewayResult> {
    const requestUrl = getRequestURL(event)
    let resolution: RoutingResolution
    try {
      resolution = await routingRuntimeService.resolve(
        event.method,
        requestUrl.pathname,
        requestUrl.hostname
      )
    } catch (error) {
      const unavailable = routingRuntimeUnavailableResult(event, error)
      if (unavailable) return unavailable
      throw error
    }
    const { match, allowedMethods } = resolution
    if (event.method.toUpperCase() === 'OPTIONS') {
      if (allowedMethods.length === 0) return { matched: false }
      const cors = setPublicApiCors(event, allowedMethods)
      if (cors.rejectedRequestHeaders.length > 0) {
        return {
          matched: true,
          response: gatewayFail(
            event,
            400,
            'CORS_REQUEST_HEADER_FORBIDDEN',
            '预检请求包含不允许跨域使用的请求头'
          )
        }
      }
      return { matched: true, response: sendNoContent(event) }
    }
    if (!match) {
      if (allowedMethods.length === 0) return { matched: false }
      setPublicApiCors(event, allowedMethods)
      setResponseHeader(event, 'allow', allowedMethods.join(', '))
      return {
        matched: true,
        response: gatewayFail(event, 405, 'METHOD_NOT_ALLOWED', '请求方法不受支持')
      }
    }

    setPublicApiCors(event, [match.route.method])
    // Keep the response correlation id platform-owned even when an upstream
    // returns a conflicting value.  The response-header sanitizer also blocks
    // the upstream copy when the stream is proxied below.
    setResponseHeader(event, 'X-Request-Id', ensureRequestId(event))
    gatewayCallService.start(event, match)

    try {
      assertGatewayRequestSize(event, match.route.maxRequestBytes)
      const access = await dynamicGatewayAccessService.authorize(event, match)
      if (!access.passed) return { matched: true, response: access.response }

      const serviceToken = await upstreamServiceTokenService.get(match.upstream.id)
      const headers = createUpstreamHeaders(event, match, serviceToken)
      const response = await forwardGatewayRequest(event, match, headers, upstreamResponse => {
        if ([502, 503, 504].includes(upstreamResponse.status)) {
          setResponseHeader(event, 'Retry-After', UPSTREAM_RETRY_AFTER_SECONDS)
        }
        captureUpstreamFailure(event, upstreamResponse)
      })
      return { matched: true, response }
    } catch (caughtError) {
      let error = caughtError
      try {
        await gatewayCallService.release(event)
      } catch (releaseError) {
        error = new BillingPersistenceError(releaseError)
      }
      const billingError = findBillingPersistenceError(error)
      if (billingError) {
        console.error('[gateway] failed to persist billing outcome', {
          routeId: match.route.id,
          error: billingError.cause instanceof Error
            ? billingError.cause.message
            : String(billingError.cause)
        })
        return gatewayFailureResult(
          event,
          503,
          'BILLING_UNAVAILABLE',
          '计费服务暂不可用，请稍后再试',
          billingError
        )
      }
      const executionError = findGatewayExecutionError(error)
      if (executionError) {
        return gatewayFailureResult(
          event,
          executionError.status,
          executionError.code,
          executionError.publicMessage,
          executionError
        )
      }
      console.error('[gateway] request preparation failed', {
        routeId: match.route.id,
        error: error instanceof Error ? error.message : String(error)
      })
      return gatewayFailureResult(event, 503, 'GATEWAY_UNAVAILABLE', '网关服务暂不可用，请稍后再试', error)
    }
  }
}
