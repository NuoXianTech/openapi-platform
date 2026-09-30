import {
  findGatewayExecutionError,
  GatewayExecutionError
} from '~~/server/errors/gateway-error'
import { limitGatewayUpstreamResponse } from '~~/server/services/dynamic-gateway-stream-service'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'
import { normalizeRoutePath } from '~~/server/utils/route-pattern'
import { gatewayTargetHealth } from '~~/server/services/gateway-target-health'
import { safeFetch } from '~~/server/utils/safe-fetch'

const RETRYABLE_METHODS = new Set(['GET', 'HEAD'])
const RETRYABLE_UPSTREAM_STATUSES = new Set([502, 503, 504])

const MIN_ATTEMPT_TIMEOUT_MS = 2_000
const MAX_TARGET_COUNTERS = 10_000
const targetCounters = new Map<string, number>()
export type GatewayTarget = ResolvedDynamicRoute['upstream']['targets'][number]

function availableTargets(match: ResolvedDynamicRoute): GatewayTarget[] {
  const targets = match.upstream.targets
  if (targets.length === 0) {
    throw new GatewayExecutionError(
      503,
      'UPSTREAM_NOT_CONFIGURED',
      '上游服务尚未配置'
    )
  }

  const available = gatewayTargetHealth.available(match.upstream.id, targets)
  // Every target is ejected: fall back to the full list so a total outage
  // still produces a real upstream error rather than a config error.
  return available.length > 0 ? available : targets
}

export function orderedGatewayTargets(
  match: ResolvedDynamicRoute
): GatewayTarget[] {
  const targets = availableTargets(match)
  const counter = targetCounters.get(match.upstream.id) ?? 0
  if (!targetCounters.has(match.upstream.id)) {
    while (targetCounters.size >= MAX_TARGET_COUNTERS) {
      const oldest = targetCounters.keys().next().value as string | undefined
      if (!oldest) break
      targetCounters.delete(oldest)
    }
  }
  targetCounters.set(
    match.upstream.id,
    (counter + 1) % Number.MAX_SAFE_INTEGER
  )
  let selectedIndex = counter % targets.length
  if (match.upstream.loadBalancing === 'weighted') {
    const totalWeight = targets.reduce(
      (sum, target) => sum + Math.max(1, target.weight),
      0
    )
    let selectedWeight = counter % totalWeight
    for (let index = 0; index < targets.length; index += 1) {
      selectedWeight -= Math.max(1, targets[index]!.weight)
      if (selectedWeight < 0) {
        selectedIndex = index
        break
      }
    }
  }
  return [
    ...targets.slice(selectedIndex),
    ...targets.slice(0, selectedIndex)
  ]
}

export async function orderedGatewayTargetsAsync(match: ResolvedDynamicRoute): Promise<GatewayTarget[]> {
  await gatewayTargetHealth.hydrate(match.upstream.id, match.upstream.targets)
  return orderedGatewayTargets(match)
}

export function resetGatewayTargetHealth(): void {
  gatewayTargetHealth.clear()
  targetCounters.clear()
}

export function buildGatewayTargetUrl(
  baseUrl: string,
  upstreamPath: string,
  search: string
): URL {
  const target = new URL(baseUrl)
  // Normalize and validate the path before assigning it to URL.pathname.
  // WHATWG URL canonicalization resolves `.`/`..` segments during assignment;
  // without this check a route parameter could escape the configured base
  // path (for example `/service/../admin`).
  const normalizedUpstreamPath = normalizeRoutePath(upstreamPath)
  const basePath = target.pathname === '/'
    ? ''
    : target.pathname.replace(/\/$/, '')
  const joinedPath = `${basePath}${normalizedUpstreamPath}` || '/'
  target.pathname = joinedPath
  if (basePath && !(
    target.pathname === basePath
    || target.pathname.startsWith(`${basePath}/`)
  )) {
    throw new Error('upstream path escaped the target base path')
  }
  const query = new URLSearchParams(search)
  // Query authentication is case-insensitive at the public boundary; remove
  // every spelling before the request reaches an Upstream so a credential can
  // never be reflected in its access logs.
  for (const key of [...query.keys()]) {
    if (key.toLowerCase().replace(/[-_]/g, '') === 'apikey') {
      query.delete(key)
    }
  }
  target.search = query.toString()
  target.hash = ''
  return target
}

async function fetchTarget(
  targetUrl: URL,
  init: RequestInit | undefined
): Promise<Response> {
  return safeFetch(targetUrl, {
    ...init,
    allowedHosts: [targetUrl.hostname],
    allowSubdomains: false,
    followRedirects: false,
    allowHttp: true,
    allowPrivateNetworks: true,
    allowNonDefaultPort: true
  })
}

function isServiceTokenRejection(response: Response): boolean {
  return response.status === 401
    && response.headers.get('x-openapi-error-code') === 'UNAUTHORIZED'
    && response.headers.get('www-authenticate')
      ?.trim()
      .toLowerCase()
      .startsWith('service ') === true
}

export function createGatewayProxyFetch(input: {
  match: ResolvedDynamicRoute
  targets: GatewayTarget[]
  upstreamPath: string
  search: string
  maximumResponseBytes: number
  onTarget: (target: GatewayTarget) => void
  onResponseBytes: (receivedBytes: number) => void
}): typeof fetch {
  return async (_request, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const route = input.match.route
    const allowCaching = !route.isApiKey
      && !route.isStatistics
      && route.creditsCost === 0
      && ![route.rateLimitPerSecond, route.rateLimitPerMinute,
        route.rateLimitPerHour, route.rateLimitPerDay].some(limit => limit > 0)
    const mayRetry = RETRYABLE_METHODS.has(method)
    const targets = mayRetry ? input.targets : input.targets.slice(0, 1)
    const overallSignal = init?.signal ?? null
    const attemptTimeoutMs = targets.length > 1
      ? Math.max(
          MIN_ATTEMPT_TIMEOUT_MS,
          Math.floor(input.match.route.timeoutMs / targets.length)
        )
      : null
    let lastError: unknown = null
    let lastErrorWasAttemptTimeout = false

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index]!
      const targetUrl = buildGatewayTargetUrl(
        target.baseUrl,
        input.upstreamPath,
        input.search
      )
      const observation = gatewayTargetHealth.begin(input.match.upstream.id, target)
      input.onTarget(target)
      // A per-attempt controller lets a hung target be abandoned without
      // aborting the shared signal, which would kill every later attempt.
      const attemptController = new AbortController()
      const abortAttempt = () => attemptController.abort(overallSignal?.reason)
      overallSignal?.addEventListener('abort', abortAttempt, { once: true })
      let attemptTimedOut = false
      const attemptTimer = attemptTimeoutMs === null
        ? null
        : setTimeout(() => {
            attemptTimedOut = true
            attemptController.abort(new Error('upstream attempt timeout'))
          }, attemptTimeoutMs)
      const releaseAttempt = () => {
        if (attemptTimer) clearTimeout(attemptTimer)
        overallSignal?.removeEventListener('abort', abortAttempt)
      }
      try {
        const response = await fetchTarget(targetUrl, {
          ...init,
          signal: attemptController.signal
        })
        // Headers arrived: stop the attempt clock so it cannot abort the
        // response body mid-stream. The overall-signal listener stays so a
        // route timeout or client disconnect still tears the body down.
        if (attemptTimer) clearTimeout(attemptTimer)
        const retryableStatus = RETRYABLE_UPSTREAM_STATUSES.has(response.status)
        gatewayTargetHealth.report(observation, !retryableStatus)

        if (isServiceTokenRejection(response)) {
          await response.body?.cancel().catch(() => undefined)
          throw new GatewayExecutionError(
            502,
            'UPSTREAM_AUTH_FAILED',
            '上游服务认证失败'
          )
        }

        if (retryableStatus && index < targets.length - 1) {
          releaseAttempt()
          await response.body?.cancel().catch(() => undefined)
          continue
        }
        return limitGatewayUpstreamResponse(
          response,
          input.maximumResponseBytes,
          input.onResponseBytes,
          allowCaching
        )
      } catch (error) {
        releaseAttempt()
        if (findGatewayExecutionError(error)) throw error
        // The client went away or the route budget expired: the target is
        // not at fault and no later attempt can succeed.
        if (overallSignal?.aborted) throw error
        gatewayTargetHealth.report(observation, false)
        lastError = error
        lastErrorWasAttemptTimeout = attemptTimedOut
        if (!mayRetry || index === targets.length - 1) break
      }
    }
    if (lastErrorWasAttemptTimeout) {
      throw new GatewayExecutionError(
        504,
        'UPSTREAM_TIMEOUT',
        '上游服务响应超时'
      )
    }
    throw lastError ?? new Error('upstream target selection failed')
  }
}
