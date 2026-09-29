import type { H3Event } from 'h3'
import { getRequestWebStream } from 'h3'
import { GatewayExecutionError } from '~~/server/errors/gateway-error'
import { sanitizeGatewayResponseHeaders } from '~~/server/utils/gateway-response-headers'

const PAYLOAD_METHODS = new Set(['PATCH', 'POST', 'PUT', 'DELETE'])

function requestBodyLimitError(maximumBytes: number): GatewayExecutionError {
  return maximumBytes === 0
    ? new GatewayExecutionError(
        413,
        'REQUEST_BODY_NOT_ALLOWED',
        '此接口不接受请求体'
      )
    : new GatewayExecutionError(
        413,
        'REQUEST_BODY_TOO_LARGE',
        '请求体超过接口限制'
      )
}

function contentLength(
  value: string | string[] | null | undefined
): number | null {
  const normalized = Array.isArray(value) ? value[0] : value
  if (!normalized || !/^\d+$/.test(normalized)) return null
  const parsed = Number(normalized)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function assertGatewayRequestSize(
  event: H3Event,
  maximumBytes: number
): void {
  const declaredLength = contentLength(event.node.req.headers['content-length'])
  if (declaredLength !== null && declaredLength > maximumBytes) {
    throw requestBodyLimitError(maximumBytes)
  }
}

function limitGatewayByteStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
  error: () => GatewayExecutionError,
  onBytes?: (receivedBytes: number) => void
): ReadableStream<Uint8Array> {
  let receivedBytes = 0
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      receivedBytes += chunk.byteLength
      onBytes?.(receivedBytes)
      if (receivedBytes > maximumBytes) throw error()
      controller.enqueue(chunk)
    }
  }))
}

export function createGatewayRequestBody(
  event: H3Event,
  maximumBytes: number,
  onBytes?: (receivedBytes: number) => void
): ReadableStream<Uint8Array> | undefined {
  if (!PAYLOAD_METHODS.has(event.method.toUpperCase())) return undefined
  const stream = getRequestWebStream(event)
  if (!stream) return undefined
  return limitGatewayByteStream(
    stream,
    maximumBytes,
    () => requestBodyLimitError(maximumBytes),
    onBytes
  )
}

export async function limitGatewayUpstreamResponse(
  response: Response,
  maximumBytes: number,
  onBytes?: (receivedBytes: number) => void,
  allowCaching = true
): Promise<Response> {
  const headers = sanitizeGatewayResponseHeaders(response.headers, allowCaching)
  if (!response.body) {
    onBytes?.(0)
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers
    })
  }
  const declaredLength = contentLength(response.headers.get('content-length'))
  if (declaredLength !== null && declaredLength > maximumBytes) {
    await response.body.cancel().catch(() => undefined)
    throw new GatewayExecutionError(
      502,
      'UPSTREAM_RESPONSE_TOO_LARGE',
      '上游响应超过接口限制'
    )
  }
  return new Response(
    limitGatewayByteStream(
      response.body,
      maximumBytes,
      () => new GatewayExecutionError(
        502,
        'UPSTREAM_RESPONSE_TOO_LARGE',
        '上游响应超过接口限制'
      ),
      onBytes
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers
    }
  )
}
