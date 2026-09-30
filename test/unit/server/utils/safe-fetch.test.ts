import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  closeSafeFetchTransports,
  isHostnameWithin,
  readLimitedText,
  safeFetch
} from '../../../../server/utils/safe-fetch'
import { fetchUpstreamTarget } from '~~/server/utils/upstream-target-fetch'

type PinnedLookup = (
  hostname: string,
  options: Record<string, unknown>,
  callback: (error: Error | null, address: string | Array<{ address: string, family: number }>, family?: number) => void
) => void

const networkMocks = vi.hoisted(() => ({
  agentOptions: null as { connect?: { lookup?: PinnedLookup } } | null,
  agentCount: 0,
  lookup: vi.fn()
}))

vi.mock('node:dns/promises', () => ({ lookup: networkMocks.lookup }))
vi.mock('undici', () => ({
  Agent: class {
    constructor(options: { connect?: { lookup?: PinnedLookup } }) {
      networkMocks.agentOptions = options
      networkMocks.agentCount += 1
    }

    async close() {}
  },
  fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args)
}))

beforeEach(async () => {
  await closeSafeFetchTransports()
  networkMocks.agentOptions = null
  networkMocks.agentCount = 0
  networkMocks.lookup.mockReset()
  networkMocks.lookup.mockImplementation(async (hostname: string) => [{
    address: hostname,
    family: hostname.includes(':') ? 6 : 4
  }])
})

afterEach(async () => {
  await closeSafeFetchTransports()
  vi.restoreAllMocks()
})

describe('isHostnameWithin', () => {
  it('accepts the configured hostname and its subdomains', () => {
    expect(isHostnameWithin('example.com', 'example.com')).toBe(true)
    expect(isHostnameWithin('api.example.com', 'example.com')).toBe(true)
    expect(isHostnameWithin('API.EXAMPLE.COM.', 'example.com')).toBe(true)
  })

  it('rejects hostname suffix tricks', () => {
    expect(isHostnameWithin('example.com.evil.test', 'example.com')).toBe(false)
    expect(isHostnameWithin('notexample.com', 'example.com')).toBe(false)
    expect(isHostnameWithin('example.com@evil.test', 'example.com')).toBe(false)
  })
})

describe('safeFetch', () => {
  it.each(['8.8.8.8', '::ffff:8.8.8.8', '2001:4860:4860::8888'])('rejects managed HTTP names resolving to %s before sending credentials', async (address) => {
    networkMocks.lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }])
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unexpected'))
    await expect(fetchUpstreamTarget('http://service.internal:8080/configuration', {
      headers: { authorization: 'Service test-token' }
    })).rejects.toThrow('public upstream targets must use HTTPS')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a mixed public/private DNS answer for managed HTTP', async () => {
    networkMocks.lookup.mockResolvedValue([{ address: '10.0.0.2', family: 4 }, { address: '8.8.8.8', family: 4 }])
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unexpected'))
    await expect(fetchUpstreamTarget('http://service:8080')).rejects.toThrow('must use HTTPS')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains private HTTP and public HTTPS support with pinned connections and no redirects', async () => {
    networkMocks.lookup.mockResolvedValueOnce([{ address: '10.0.0.2', family: 4 }])
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(null, {
      status: 302, headers: { location: 'https://other.example/configuration' }
    }))
    expect((await fetchUpstreamTarget('http://service:8080')).status).toBe(302)
    expect((await fetchUpstreamTarget('https://public.example')).status).toBe(302)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual', dispatcher: expect.anything() })
  })

  it('rejects non-HTTPS URLs before making a request', async () => {
    await expect(safeFetch('http://example.com/resource', {
      allowedHosts: ['example.com']
    })).rejects.toThrow('upstream URL must use HTTP or HTTPS')
  })

  it('rejects loopback and private network destinations', async () => {
    await expect(safeFetch('https://127.0.0.1/resource', {
      allowedHosts: ['127.0.0.1']
    })).rejects.toThrow('upstream hostname resolved to a blocked network')

    await expect(safeFetch('https://10.0.0.1/resource', {
      allowedHosts: ['10.0.0.1']
    })).rejects.toThrow('upstream hostname resolved to a blocked network')

    networkMocks.lookup.mockResolvedValueOnce([{
      address: '::ffff:7f00:1',
      family: 6
    }])
    await expect(safeFetch('https://[::ffff:7f00:1]/resource', {
      allowedHosts: ['[::ffff:7f00:1]']
    })).rejects.toThrow('upstream hostname resolved to a blocked network')
  })

  it('pins the verified DNS address for the connection', async () => {
    networkMocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const pinnedLookup = networkMocks.agentOptions?.connect?.lookup
      expect(pinnedLookup).toBeTypeOf('function')

      const resolved = await new Promise<{ address: string, family: number }>((resolve, reject) => {
        pinnedLookup?.('example.com', {}, (error, address, family) => {
          if (error) reject(error)
          else if (typeof address === 'string' && family) resolve({ address, family })
          else reject(new Error('expected one pinned address'))
        })
      })
      expect(resolved).toEqual({ address: '93.184.216.34', family: 4 })

      const resolvedAll = await new Promise<Array<{ address: string, family: number }>>((resolve, reject) => {
        pinnedLookup?.('example.com', { all: true }, (error, addresses) => {
          if (error) reject(error)
          else if (Array.isArray(addresses)) resolve(addresses)
          else reject(new Error('expected all pinned addresses'))
        })
      })
      expect(resolvedAll).toEqual([{ address: '93.184.216.34', family: 4 }])
      expect((init as RequestInit & { dispatcher?: unknown }).dispatcher).toBeDefined()
      return new Response('ok')
    })

    await expect(safeFetch('https://example.com/resource', {
      allowedHosts: ['example.com']
    })).resolves.toBeInstanceOf(Response)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reuses a DNS-pinned dispatcher for a fixed non-redirecting Target', async () => {
    networkMocks.lookup.mockResolvedValue([{
      address: '93.184.216.34',
      family: 4
    }])
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok'))
    const options = {
      allowedHosts: ['example.com'],
      followRedirects: false
    } as const

    await safeFetch('https://example.com/first', options)
    await safeFetch('https://example.com/second', options)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(networkMocks.lookup).toHaveBeenCalledOnce()
    expect(networkMocks.agentCount).toBe(1)
  })

  it('allows a public IPv4-mapped IPv6 destination', async () => {
    networkMocks.lookup.mockResolvedValueOnce([{
      address: '::ffff:5db8:d822',
      family: 6
    }])
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('ok'))

    await expect(safeFetch('https://[::ffff:5db8:d822]/resource', {
      allowedHosts: ['::ffff:5db8:d822']
    })).resolves.toBeInstanceOf(Response)
    expect(networkMocks.lookup).toHaveBeenCalledWith(
      '::ffff:5db8:d822',
      { all: true, verbatim: true }
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not forward credentials across an origin-changing redirect', async () => {
    networkMocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }
    ])
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://sub.example.com/next' }
      }))
      .mockResolvedValueOnce(new Response('ok'))

    await expect(safeFetch('https://example.com/start', {
      allowedHosts: ['example.com'],
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret'
      }
    })).resolves.toBeInstanceOf(Response)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const redirectedInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    const redirectedHeaders = new Headers(redirectedInit.headers)
    expect(redirectedHeaders.has('authorization')).toBe(false)
    expect(redirectedHeaders.has('cookie')).toBe(false)
  })

  it('can require an exact redirect host', async () => {
    networkMocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 }
    ])
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {
      status: 302,
      headers: { location: 'https://sub.example.com/next' }
    }))

    await expect(safeFetch('https://example.com/start', {
      allowedHosts: ['example.com'],
      allowSubdomains: false
    })).rejects.toThrow('upstream hostname is not allowed')
  })
})

describe('readLimitedText', () => {
  it('rejects response bodies larger than the configured limit', async () => {
    const response = new Response('12345')
    await expect(readLimitedText(response, 4)).rejects.toThrow('upstream response is too large')
  })
})
