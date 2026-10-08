import type { H3Error } from 'h3'
import { getRequestURL, send } from 'h3'
import { defineNitroErrorHandler } from 'nitropack/runtime'
import { gatewayCallService } from '~~/server/services/dynamic-gateway-call-service'
import { gatewayFail } from '~~/server/utils/gateway-response'
import { isReservedPlatformPath } from '~~/server/utils/route-pattern'

const PUBLIC_ERROR_BY_STATUS: Record<number, { code: string, message: string }> = {
  400: { code: 'BAD_REQUEST', message: '请求参数有误' },
  401: { code: 'UNAUTHORIZED', message: '请求未通过身份验证' },
  403: { code: 'FORBIDDEN', message: '无权访问该接口' },
  404: { code: 'API_NOT_FOUND', message: '接口不存在' },
  405: { code: 'METHOD_NOT_ALLOWED', message: '请求方法不受支持' },
  413: { code: 'REQUEST_BODY_TOO_LARGE', message: '请求体超过接口限制' },
  499: { code: 'CLIENT_DISCONNECTED', message: '客户端已断开连接' },
  429: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' },
  500: { code: 'INTERNAL_ERROR', message: '服务内部错误' },
  502: { code: 'UPSTREAM_UNAVAILABLE', message: '上游服务暂时不可用' },
  503: { code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后再试' },
  504: { code: 'UPSTREAM_TIMEOUT', message: '上游服务响应超时' }
}

function resolvePublicError(status: number): { code: string, message: string } {
  const configured = PUBLIC_ERROR_BY_STATUS[status]
  if (configured) return configured
  return status < 500
    ? { code: 'BAD_REQUEST', message: '请求无法处理' }
    : { code: 'SERVICE_UNAVAILABLE', message: '服务暂不可用，请稍后再试' }
}

function resolveKnownError(error: H3Error): { code: string, message: string } | null {
  const code = (error as unknown as { code?: unknown }).code
    ?? (error as unknown as { data?: { code?: unknown } }).data?.code
  return code === 'ROUTING_RUNTIME_UNAVAILABLE'
    ? { code, message: '网关路由暂不可用，请稍后再试' }
    : null
}

export default defineNitroErrorHandler(function handlePublicApiRouteError(error: H3Error, event) {
  if (isReservedPlatformPath(getRequestURL(event).pathname)) return
  const status = error.statusCode >= 400 && error.statusCode <= 599
    ? error.statusCode
    : 500
  const fallback = resolveKnownError(error) ?? resolvePublicError(status)
  gatewayCallService.fail(event, fallback.code, fallback.message)
  const response = gatewayFail(event, status, fallback.code, fallback.message)
  return send(event, JSON.stringify(response), 'application/json')
})
