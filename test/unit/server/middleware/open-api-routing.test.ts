import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dynamicGatewayMocks = vi.hoisted(() => ({
  tryHandle: vi.fn()
}))

vi.mock('~~/server/services/dynamic-gateway-service', () => ({
  dynamicGatewayService: dynamicGatewayMocks
}))
vi.stubGlobal('defineEventHandler', <T>(handler: T) => handler)

const { default: handleOpenApiRouting } = await import('~~/server/middleware/01-open-api-routing')

function createMockEvent(path: string, method = 'GET'): H3Event {
  const responseHeaders = new Map<string, unknown>()
  return {
    path,
    method,
    context: {},
    node: {
      req: {
        url: path,
        originalUrl: path,
        method,
        headers: { host: 'localhost' }
      },
      res: {
        statusCode: 200,
        setHeader(name: string, value: unknown) {
          responseHeaders.set(name.toLowerCase(), value)
        },
        getHeader(name: string) {
          return responseHeaders.get(name.toLowerCase())
        },
        removeHeader(name: string) {
          responseHeaders.delete(name.toLowerCase())
        },
        writeHead() {},
        end() {}
      }
    }
  } as unknown as H3Event
}

beforeEach(() => {
  vi.clearAllMocks()
  dynamicGatewayMocks.tryHandle.mockResolvedValue({ matched: false })
})

describe('dynamic API routing middleware', () => {
  it('returns the response produced by the dynamic Gateway', async () => {
    const response = { proxied: true }
    dynamicGatewayMocks.tryHandle.mockResolvedValue({ matched: true, response })
    const event = createMockEvent('/v1/proxy-smoke')

    await expect(handleOpenApiRouting(event)).resolves.toBe(response)
    expect(event.node.res.getHeader('access-control-allow-origin')).toBe('*')
  })

  it('returns the public API error contract when no published Route matches', async () => {
    const event = createMockEvent('/v1/not-found')

    await expect(handleOpenApiRouting(event)).resolves.toMatchObject({
      code: 'API_NOT_FOUND',
      message: '接口不存在',
      data: null
    })
    expect(event.node.res.statusCode).toBe(404)
    expect(event.node.res.getHeader('access-control-allow-origin')).toBe('*')
    expect(event.node.res.getHeader('access-control-allow-headers'))
      .toBe('content-type, x-api-key, x-request-id')
    expect(event.node.res.getHeader('access-control-max-age')).toBe(600)
    expect(dynamicGatewayMocks.tryHandle).toHaveBeenCalledOnce()
  })

  it('never sends Platform control-plane paths to the dynamic Gateway', async () => {
    const event = createMockEvent('/api/admin/v1/routes')

    await expect(handleOpenApiRouting(event)).resolves.toBeUndefined()
    expect(event.node.res.getHeader('access-control-allow-origin')).toBeUndefined()
    expect(dynamicGatewayMocks.tryHandle).not.toHaveBeenCalled()
  })

  it.each(['GET', 'HEAD'])('serves bundled fonts outside the Gateway for %s requests', async (method) => {
    const event = createMockEvent('/fonts/inter-latin-wght-normal.woff2', method)
    await expect(handleOpenApiRouting(event)).resolves.toBeUndefined()
    expect(dynamicGatewayMocks.tryHandle).not.toHaveBeenCalled()
    expect(event.node.res.getHeader('access-control-allow-origin')).toBeUndefined()
  })
})
