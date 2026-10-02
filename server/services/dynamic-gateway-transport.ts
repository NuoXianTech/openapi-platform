import { getRequestURL, sendProxy, type H3Event } from 'h3'
import { gatewayCallService } from '~~/server/services/dynamic-gateway-call-service'
import {
  findBillingPersistenceError,
  findGatewayExecutionError,
  GatewayExecutionError
} from '~~/server/errors/gateway-error'
import { createGatewayRequestBody, limitGatewayUpstreamResponse } from '~~/server/services/dynamic-gateway-stream-service'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'
import { normalizeRoutePath, renderUpstreamPath } from '~~/server/utils/route-pattern'
import { gatewayTargetHealth } from '~~/server/services/gateway-target-health'
import { fetchUpstreamTarget } from '~~/server/utils/upstream-target-fetch'

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

async function orderedGatewayTargetsAsync(match: ResolvedDynamicRoute): Promise<GatewayTarget[]> {
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
      overallSignal?.throwIfAborted()
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
        const response = await fetchUpstreamTarget(targetUrl, {
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
        const limited = await limitGatewayUpstreamResponse(
          response, input.maximumResponseBytes, input.onResponseBytes, allowCaching
        )
        return releaseAfterBody(limited, releaseAttempt)
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

// The final attempt remains connected to the overall abort signal until its
// body closes, errors or is cancelled, then releases the listener exactly once.
function releaseAfterBody(response: Response, release: () => void): Response {
  if (!response.body) {
    release()
    return response
  }
  const reader = response.body.getReader()
  let released = false
  const finish = () => {
    if (released) return
    released = true
    release()
    reader.releaseLock()
  }
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) { finish(); controller.close() }
        else controller.enqueue(value)
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason) } finally { finish() }
    }
  }, { highWaterMark: 0 }), {
    status: response.status, statusText: response.statusText, headers: response.headers
  })
}

/** Own one transfer through the last response byte, including all attempts. */
export async function forwardGatewayRequest(
  event: H3Event,
  match: ResolvedDynamicRoute,
  headers: Headers,
  onResponse: (response: Response) => void
): Promise<unknown> {
  const controller = new AbortController()
  let abortError: GatewayExecutionError | null = null
  let timeout: ReturnType<typeof setTimeout> | undefined
  let targetId: string | null = null
  let proxyStarted = false
  const abort = (error: GatewayExecutionError) => {
    if (controller.signal.aborted) return
    abortError = error
    controller.abort(error)
  }
  const disconnect = () => abort(new GatewayExecutionError(499, 'CLIENT_DISCONNECTED', '客户端已断开连接'))
  const close = () => { if (!event.node.res.writableEnded) disconnect() }
  event.node.req.once('aborted', disconnect)
  event.node.res.once('close', close)
  try {
    if (event.node.req.aborted || event.node.res.destroyed) disconnect()
    controller.signal.throwIfAborted()
    const targets = await orderedGatewayTargetsAsync(match)
    controller.signal.throwIfAborted()
    const requestUrl = getRequestURL(event)
    const upstreamPath = renderUpstreamPath(match.route.upstreamPathTemplate, match.params)
    const url = buildGatewayTargetUrl(targets[0]!.baseUrl, upstreamPath, requestUrl.search)
    targetId = targets[0]!.id
    timeout = setTimeout(() => abort(new GatewayExecutionError(504, 'UPSTREAM_TIMEOUT', '上游服务响应超时')), match.route.timeoutMs)
    const body = createGatewayRequestBody(event, match.route.maxRequestBytes, requestBytes => {
      gatewayCallService.observe(event, { requestBytes })
    })
    const fetch = createGatewayProxyFetch({
      match, targets, upstreamPath, search: requestUrl.search,
      maximumResponseBytes: match.route.maxResponseBytes,
      onTarget: target => {
        targetId = target.id
        gatewayCallService.observe(event, { target })
      },
      onResponseBytes: responseBytes => gatewayCallService.observe(event, { responseBytes })
    })
    proxyStarted = true
    return await sendProxy(event, url.toString(), {
      fetch: async (request, init) => gatewayCallService.prepareResponse(event, await fetch(request, init), controller.signal),
      sendStream: true,
      onResponse: (_event, response) => onResponse(response),
      fetchOptions: {
        method: event.method, headers, body, duplex: body ? 'half' : undefined,
        redirect: 'manual', signal: controller.signal
      }
    })
  } catch (error) {
    if (findBillingPersistenceError(error)) throw error
    if (abortError) throw abortError
    if (findGatewayExecutionError(error)) throw error
    console.error('[gateway] upstream request failed', {
      routeId: match.route.id, target: targetId,
      error: error instanceof Error ? error.message : String(error)
    })
    throw proxyStarted
      ? new GatewayExecutionError(502, 'UPSTREAM_UNAVAILABLE', '上游服务暂时不可用')
      : new GatewayExecutionError(503, 'GATEWAY_UNAVAILABLE', '网关服务暂不可用，请稍后再试')
  } finally {
    if (timeout) clearTimeout(timeout)
    event.node.req.off('aborted', disconnect)
    event.node.res.off('close', close)
    // A failed delivery/preparation may leave a body unread. Terminate its
    // transport even when no client-disconnect event was emitted.
    controller.abort()
  }
}
