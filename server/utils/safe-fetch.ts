import { lookup } from 'node:dns/promises'
import { isIP, type LookupFunction } from 'node:net'
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from 'undici'
import { ipInAnyCidr } from '#shared/utils/cidr'
import { isPrivateUpstreamHostname } from '#shared/utils/upstream-target'

const BLOCKED_NETWORKS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::/128',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  'ff00::/8',
  '2001:db8::/32'
] as const

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])
const DNS_LOOKUP_TIMEOUT_MS = 2_000
const DNS_CACHE_TTL_MS = 5_000
const DISPATCHER_CACHE_TTL_MS = 30_000
const MAX_TRANSPORT_CACHE_ENTRIES = 512
type ResolvedAddress = { address: string, family: number }

interface DnsCacheEntry {
  addresses: ResolvedAddress[]
  expiresAt: number
}

interface DispatcherCacheEntry {
  dispatcher: Agent
  pinnedAddresses: Map<string, ResolvedAddress[]>
  expiresAt: number
}

const dnsCache = new Map<string, DnsCacheEntry>()
const pendingDnsLookups = new Map<string, Promise<ResolvedAddress[]>>()
const dispatcherCache = new Map<string, DispatcherCacheEntry>()
let transportCacheGeneration = 0

export interface SafeFetchOptions extends RequestInit {
  allowedHosts: readonly string[]
  maxRedirects?: number
  allowHttp?: boolean | 'private-only'
  allowPrivateNetworks?: boolean
  allowNonDefaultPort?: boolean
  /** Allow subdomains of entries in allowedHosts (default: true). */
  allowSubdomains?: boolean
  /** Follow validated redirects (default: true). */
  followRedirects?: boolean
}

function normalizeHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
}

export function isHostnameWithin(hostname: string, allowedHost: string): boolean {
  const normalizedHostname = normalizeHostname(hostname)
  const normalizedAllowedHost = normalizeHostname(allowedHost)
  return normalizedHostname === normalizedAllowedHost
    || normalizedHostname.endsWith(`.${normalizedAllowedHost}`)
}

function assertAllowedHostname(
  hostname: string,
  allowedHosts: readonly string[],
  allowSubdomains: boolean
): void {
  const normalizedHostname = normalizeHostname(hostname)
  if (!allowedHosts.some((allowedHost) => {
    const normalizedAllowedHost = normalizeHostname(allowedHost)
    return normalizedHostname === normalizedAllowedHost
      || (allowSubdomains && normalizedHostname.endsWith(`.${normalizedAllowedHost}`))
  })) {
    throw new Error('upstream hostname is not allowed')
  }
}

function assertPublicAddress(address: string): void {
  if (!isIP(address) || ipInAnyCidr(address, BLOCKED_NETWORKS)) {
    throw new Error('upstream hostname resolved to a blocked network')
  }
}

function pruneDnsCache(now = Date.now()): void {
  for (const [hostname, entry] of dnsCache) {
    if (entry.expiresAt <= now) dnsCache.delete(hostname)
  }
  while (dnsCache.size > MAX_TRANSPORT_CACHE_ENTRIES) {
    const oldest = dnsCache.keys().next().value as string | undefined
    if (!oldest) break
    dnsCache.delete(oldest)
  }
}

async function resolveAddresses(hostname: string): Promise<ResolvedAddress[]> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('upstream DNS lookup timed out')),
          DNS_LOOKUP_TIMEOUT_MS
        )
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function lookupAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const key = normalizeHostname(hostname)
  const now = Date.now()
  const cached = dnsCache.get(key)
  if (cached && cached.expiresAt > now) {
    dnsCache.delete(key)
    dnsCache.set(key, cached)
    return cached.addresses
  }
  if (cached) dnsCache.delete(key)

  const pending = pendingDnsLookups.get(key)
  if (pending) return pending
  const generation = transportCacheGeneration
  const loading = resolveAddresses(key).then((addresses) => {
    if (generation === transportCacheGeneration) {
      dnsCache.set(key, {
        addresses,
        expiresAt: Date.now() + DNS_CACHE_TTL_MS
      })
      pruneDnsCache()
    }
    return addresses
  })
  pendingDnsLookups.set(key, loading)
  try {
    return await loading
  } finally {
    if (pendingDnsLookups.get(key) === loading) {
      pendingDnsLookups.delete(key)
    }
  }
}

async function assertSafeUrl(
  input: string | URL,
  allowedHosts: readonly string[],
  pinnedAddresses: Map<string, ResolvedAddress[]>,
  options: Pick<SafeFetchOptions, 'allowHttp' | 'allowPrivateNetworks' | 'allowNonDefaultPort' | 'allowSubdomains'>
): Promise<URL> {
  const url = input instanceof URL ? new URL(input) : new URL(input)
  if (url.protocol !== 'https:' && !(options.allowHttp && url.protocol === 'http:')) {
    throw new Error('upstream URL must use HTTP or HTTPS')
  }
  if (url.username || url.password) throw new Error('upstream URL credentials are not allowed')
  if (
    url.port
    && !options.allowNonDefaultPort
    && ((url.protocol === 'https:' && url.port !== '443')
      || (url.protocol === 'http:' && url.port !== '80'))
  ) throw new Error('upstream URL port is not allowed')

  assertAllowedHostname(url.hostname, allowedHosts, options.allowSubdomains ?? true)

  const hostname = normalizeHostname(url.hostname)
  const addresses = await lookupAddresses(hostname)
  if (addresses.length === 0) throw new Error('upstream hostname did not resolve')
  if (!options.allowPrivateNetworks) {
    for (const { address } of addresses) assertPublicAddress(address)
  }
  if (url.protocol === 'http:' && options.allowHttp === 'private-only') {
    if (addresses.some(({ address }) => !isIP(address) || !isPrivateUpstreamHostname(address))) {
      throw new Error('public upstream targets must use HTTPS')
    }
  }
  pinnedAddresses.set(hostname, addresses)

  return url
}

function createPinnedDispatcher(pinnedAddresses: Map<string, ResolvedAddress[]>) {
  const pinnedLookup: LookupFunction = (hostname, options, callback) => {
    const addresses = pinnedAddresses.get(normalizeHostname(hostname))
    const matchingAddresses = addresses?.filter(address => !options.family || address.family === options.family) ?? []
    if (matchingAddresses.length === 0) {
      callback(new Error('upstream hostname has no verified address'), '', 0)
      return
    }
    if (options.all) {
      callback(null, matchingAddresses)
      return
    }
    const selected = matchingAddresses[0]!
    callback(null, selected.address, selected.family)
  }

  return new Agent({ connect: { lookup: pinnedLookup } })
}

function closeDispatcher(dispatcher: Agent): void {
  void dispatcher.close().catch(() => undefined)
}

function pruneDispatcherCache(now = Date.now()): void {
  for (const [key, entry] of dispatcherCache) {
    if (entry.expiresAt > now) continue
    dispatcherCache.delete(key)
    closeDispatcher(entry.dispatcher)
  }
  while (dispatcherCache.size > MAX_TRANSPORT_CACHE_ENTRIES) {
    const oldest = dispatcherCache.keys().next().value as string | undefined
    if (!oldest) break
    const entry = dispatcherCache.get(oldest)
    dispatcherCache.delete(oldest)
    if (entry) closeDispatcher(entry.dispatcher)
  }
}

function dispatcherCacheKey(
  url: URL,
  allowedHosts: readonly string[],
  options: Pick<
    SafeFetchOptions,
    'allowHttp' | 'allowPrivateNetworks' | 'allowNonDefaultPort' | 'allowSubdomains'
  >
): string {
  return JSON.stringify({
    origin: url.origin,
    allowedHosts: allowedHosts.map(normalizeHostname).sort(),
    allowHttp: options.allowHttp ?? false,
    allowPrivateNetworks: options.allowPrivateNetworks === true,
    allowNonDefaultPort: options.allowNonDefaultPort === true,
    allowSubdomains: options.allowSubdomains !== false
  })
}

function acquireCachedDispatcher(
  key: string,
  verifiedAddresses: Map<string, ResolvedAddress[]>
): DispatcherCacheEntry {
  const now = Date.now()
  pruneDispatcherCache(now)
  const cached = dispatcherCache.get(key)
  if (cached) {
    for (const [hostname, addresses] of verifiedAddresses) {
      cached.pinnedAddresses.set(hostname, addresses)
    }
    dispatcherCache.delete(key)
    dispatcherCache.set(key, cached)
    return cached
  }

  const pinnedAddresses = new Map(verifiedAddresses)
  const created = {
    dispatcher: createPinnedDispatcher(pinnedAddresses),
    pinnedAddresses,
    expiresAt: now + DISPATCHER_CACHE_TTL_MS
  }
  dispatcherCache.set(key, created)
  pruneDispatcherCache(now)
  return created
}

function evictCachedDispatcher(key: string, dispatcher: Agent): void {
  const cached = dispatcherCache.get(key)
  if (cached?.dispatcher !== dispatcher) return
  dispatcherCache.delete(key)
  closeDispatcher(dispatcher)
}

export async function closeSafeFetchTransports(): Promise<void> {
  transportCacheGeneration += 1
  dnsCache.clear()
  pendingDnsLookups.clear()
  const dispatchers = [...dispatcherCache.values()].map(entry => entry.dispatcher)
  dispatcherCache.clear()
  await Promise.all(dispatchers.map(dispatcher => (
    dispatcher.close().catch(() => undefined)
  )))
}

const CREDENTIAL_HEADERS = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-auth-token'
] as const

function redirectedRequestInit(
  status: number,
  options: RequestInit,
  previousUrl: URL,
  nextUrl: URL
): RequestInit {
  const method = (options.method || 'GET').toUpperCase()
  let nextOptions = options
  if (status === 303 || ((status === 301 || status === 302) && method === 'POST')) {
    const headers = new Headers(options.headers)
    headers.delete('content-length')
    headers.delete('content-type')
    nextOptions = { ...options, method: 'GET', body: undefined, headers }
  }

  // A redirect can cross an origin even when both hosts are in the configured
  // allow-list (for example `service.example.com` -> `evil.service.example.com`).
  // Never forward caller credentials to a different origin.
  if (previousUrl.origin !== nextUrl.origin) {
    const headers = new Headers(nextOptions.headers)
    for (const name of CREDENTIAL_HEADERS) headers.delete(name)
    nextOptions = { ...nextOptions, headers }
  }
  return nextOptions
}

export async function safeFetch(input: string | URL, options: SafeFetchOptions): Promise<Response> {
  const {
    allowedHosts,
    maxRedirects = 5,
    allowHttp = false,
    allowPrivateNetworks = false,
    allowNonDefaultPort = false,
    allowSubdomains = true,
    followRedirects = true,
    ...requestOptions
  } = options
  const pinnedAddresses = new Map<string, ResolvedAddress[]>()
  const urlOptions = { allowHttp, allowPrivateNetworks, allowNonDefaultPort, allowSubdomains }
  let currentUrl = await assertSafeUrl(input, allowedHosts, pinnedAddresses, urlOptions)
  let currentOptions: RequestInit = { ...requestOptions, redirect: 'manual' }
  const cacheKey = followRedirects
    ? null
    : dispatcherCacheKey(currentUrl, allowedHosts, urlOptions)
  const cached = cacheKey
    ? acquireCachedDispatcher(cacheKey, pinnedAddresses)
    : null
  const dispatcher = cached?.dispatcher
    ?? createPinnedDispatcher(pinnedAddresses)

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const response = await undiciFetch(currentUrl, {
        ...currentOptions,
        dispatcher
      } as unknown as UndiciRequestInit)
      if (!REDIRECT_STATUS_CODES.has(response.status) || !followRedirects) {
        if (!cached) closeDispatcher(dispatcher)
        return response as unknown as Response
      }

      const location = response.headers.get('location')
      if (!location) {
        closeDispatcher(dispatcher)
        return response as unknown as Response
      }
      if (redirectCount === maxRedirects) {
        await response.body?.cancel()
        throw new Error('upstream redirect limit exceeded')
      }

      const nextUrl = await assertSafeUrl(
        new URL(location, currentUrl),
        allowedHosts,
        pinnedAddresses,
        urlOptions
      )
      await response.body?.cancel()
      currentOptions = redirectedRequestInit(
        response.status,
        currentOptions,
        currentUrl,
        nextUrl
      )
      currentUrl = nextUrl
    }

    throw new Error('upstream redirect limit exceeded')
  } catch (error) {
    if (cacheKey) evictCachedDispatcher(cacheKey, dispatcher)
    else await dispatcher.close()
    throw error
  }
}

export async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel()
    throw new Error('upstream response is too large')
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let receivedBytes = 0
  let text = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > maxBytes) throw new Error('upstream response is too large')
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}
