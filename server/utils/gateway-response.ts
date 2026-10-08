import type { H3Event } from 'h3'
import { setResponseHeader, setResponseStatus } from 'h3'
import { ensureRequestId } from '~~/server/utils/request-id'

export interface GatewayResponse<T = unknown> {
  code: string
  message: string
  data: T | null
  timestamp: number
}

export function gatewayFail<T = unknown>(
  event: H3Event,
  status: number,
  code: string,
  message: string,
  data: T | null = null
): GatewayResponse<T> {
  setResponseHeader(event, 'cache-control', 'no-store')
  setResponseHeader(event, 'content-type', 'application/json; charset=utf-8')
  setResponseHeader(event, 'X-Request-Id', ensureRequestId(event))
  setResponseStatus(event, status)
  return {
    code,
    message,
    data,
    timestamp: Date.now()
  }
}
