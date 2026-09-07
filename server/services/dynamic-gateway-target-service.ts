import {
  findGatewayExecutionError,
  GatewayExecutionError
} from '~~/server/errors/gateway-error'
import { limitGatewayUpstreamResponse } from '~~/server/services/dynamic-gateway-stream-service'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'
import { normalizeRoutePath } from '~~/server/utils/route-pattern'
import { getRedisClient, getRedisConfig } from '~~/server/utils/redis'
import { safeFetch } from '~~/server/utils/safe-fetch'

const RETRYABLE_METHODS = new Set(['GET', 'HEAD'])
const RETRYABLE_UPSTREAM_STATUSES = new Set([502, 503, 504])

// A target that keeps failing is ejected for progressively longer, so a
// hard-down target stops receiving traffic instead of being retried on a
// fixed short cooldown that always expires before the next request.
const TARGET_EJECTION_BASE_MS = 15_000
const TARGET_EJECTION_MAX_MS = 5 * 60_000
const TARGET_EJECTION_THRESHOLD = 2
const TARGET_HEALTH_ENTRY_MAX_AGE_MS = 30 * 60_000
const TARGET_HEALTH_STORE_TTL_MS = TARGET_HEALTH_ENTRY_MAX_AGE_MS
const MAX_TARGET_HEALTH_ENTRIES = 10_000

// Each attempt gets a slice of the route budget so a hung target cannot
// consume the whole timeout and starve failover. Only applied when more
// than one target is eligible.
const MIN_ATTEMPT_TIMEOUT_MS = 2_000

interface TargetHealth {
  failures: number
  ejectedUntil: number
  lastFailureAt: number
}

const targetCounters = new Map<string, number>()
const targetHealth = new Map<string, TargetHealth>()
const healthHydration = new Map<string, Promise<void>>()
const healthHydratedAt = new Map<string, number>()
const healthWarnings = new Set<string>()
const HEALTH_HYDRATION_INTERVAL_MS = 5_000
const HEALTH_HYDRATION_TIMEOUT_MS = 100

export type GatewayTarget = ResolvedDynamicRoute['upstream']['targets'][number]

function targetStateKey(
  match: ResolvedDynamicRoute,
  target: GatewayTarget
): string {
  return targetIdsStateKey(match.upstream.id, target.id)
}

function targetIdsStateKey(upstreamId: string, targetId: string): string {
  return `${upstreamId}:${targetId}`
}

function targetHealthRedisKey(stateKey: string): string {
  const prefix = getRedisConfig().keyPrefix
  return `${prefix}gateway:target-health:${stateKey}`
}

function warnHealthStore(operation: string, error: unknown): void {
  if (healthWarnings.has(operation)) return
  healthWarnings.add(operation)
  console.warn('[gateway] shared target health state unavailable; using local state', {
    operation,
    error: error instanceof Error ? error.message : String(error)
  })
}

function healthRedisClient() {
  try {
    return getRedisClient()
  } catch (error) {
    warnHealthStore('client', error)
    return null
  }
}

function pruneTargetHealth(now = Date.now()): void {
  for (const [key, health] of targetHealth) {
    if (now - health.lastFailureAt > TARGET_HEALTH_ENTRY_MAX_AGE_MS) {
      targetHealth.delete(key)
    }
  }
  while (targetHealth.size > MAX_TARGET_HEALTH_ENTRIES) {
    const oldest = targetHealth.keys().next().value as string | undefined
    if (!oldest) break
    targetHealth.delete(oldest)
  }
}

async function hydrateTargetHealth(match: ResolvedDynamicRoute): Promise<void> {
  const redis = healthRedisClient()
  if (!redis) return
  const key = match.upstream.id
  const existing = healthHydration.get(key)
  if (existing) return existing
  const hydratedAt = healthHydratedAt.get(key) ?? 0
  if (hydratedAt + HEALTH_HYDRATION_INTERVAL_MS > Date.now()) return

  const task = (async () => {
    try {
      const now = Date.now()
      const entries = await Promise.all(match.upstream.targets.map(async (target) => {
        const raw = await redis.get(targetHealthRedisKey(targetStateKey(match, target)))
        if (!raw) return null
        try {
          const parsed = JSON.parse(raw) as Partial<TargetHealth>
          const failures = parsed.failures
          const lastFailureAt = parsed.lastFailureAt
          const ejectedUntil = parsed.ejectedUntil
          if (
            typeof failures !== 'number'
            || typeof ejectedUntil !== 'number'
            || typeof lastFailureAt !== 'number'
            || !Number.isSafeInteger(failures)
            || !Number.isFinite(ejectedUntil)
            || !Number.isFinite(lastFailureAt)
            || failures < 1
            || lastFailureAt <= now - TARGET_HEALTH_ENTRY_MAX_AGE_MS
          ) return null
          return {
            key: targetStateKey(match, target),
            health: {
              failures,
              ejectedUntil: Math.max(0, ejectedUntil),
              lastFailureAt
            }
          }
        } catch {
          return null
        }
      }))
      for (const entry of entries) {
        if (!entry) continue
        const local = targetHealth.get(entry.key)
        if (!local || entry.health.lastFailureAt > local.lastFailureAt) {
          targetHealth.set(entry.key, entry.health)
        }
      }
      pruneTargetHealth(now)
    } catch (error) {
      warnHealthStore('read', error)
    }
  })()
  healthHydration.set(key, task)
  try {
    await task
    if (!healthHydratedAt.has(key)) {
      while (healthHydratedAt.size >= MAX_TARGET_HEALTH_ENTRIES) {
        const oldest = healthHydratedAt.keys().next().value as string | undefined
        if (!oldest) break
        healthHydratedAt.delete(oldest)
      }
    }
    healthHydratedAt.set(key, Date.now())
  } finally {
    if (healthHydration.get(key) === task) healthHydration.delete(key)
  }
}

function persistTargetHealth(
  stateKey: string,
  health: TargetHealth
): void {
  const redis = healthRedisClient()
  if (!redis) return
  void redis.set(
    targetHealthRedisKey(stateKey),
    JSON.stringify(health),
    'PX',
    TARGET_HEALTH_STORE_TTL_MS
  ).catch(error => warnHealthStore('write', error))
}

function deletePersistedTargetHealth(stateKey: string): void {
  const redis = healthRedisClient()
  if (!redis) return
  void redis.del(targetHealthRedisKey(stateKey))
    .catch(error => warnHealthStore('delete', error))
}

function availableTargets(match: ResolvedDynamicRoute): GatewayTarget[] {
  const targets = match.upstream.targets
  if (targets.length === 0) {
    throw new GatewayExecutionError(
      503,
      'UPSTREAM_NOT_CONFIGURED',
      '上游服务尚未配置'
    )
  }

  const now = Date.now()
  const available = targets.filter((target) => {
    const health = targetHealth.get(targetStateKey(match, target))
    return !health || health.ejectedUntil <= now
  })
  // Every target is ejected: fall back to the full list so a total outage
  // still produces a real upstream error rather than a config error.
  return available.length > 0 ? available : targets
}

export function orderedGatewayTargets(
  match: ResolvedDynamicRoute
): GatewayTarget[] {
  pruneTargetHealth()
  const targets = availableTargets(match)
  const counter = targetCounters.get(match.upstream.id) ?? 0
  if (!targetCounters.has(match.upstream.id)) {
    while (targetCounters.size >= MAX_TARGET_HEALTH_ENTRIES) {
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

/**
 * Hydrate ejection state from Redis once per Upstream before selecting a
 * target.  The synchronous selector remains available for deterministic unit
 * tests and the single-process fallback; production Gateway requests use this
 * shared variant so restarts and multiple instances converge on the same
 * short-lived health state.
 */
export async function orderedGatewayTargetsAsync(
  match: ResolvedDynamicRoute
): Promise<GatewayTarget[]> {
  // Health coordination is advisory and must never consume the route's
  // request budget when Redis is unavailable. The hydration task continues in
  // the background and will converge subsequent requests.
  await new Promise<void>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve()
    }, HEALTH_HYDRATION_TIMEOUT_MS)
    void hydrateTargetHealth(match).finally(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    })
  })
  return orderedGatewayTargets(match)
}

function markTargetUnavailable(
  match: ResolvedDynamicRoute,
  target: GatewayTarget
): void {
  const key = targetStateKey(match, target)
  const failures = Math.min((targetHealth.get(key)?.failures ?? 0) + 1, 31)
  const ejectedUntil = failures >= TARGET_EJECTION_THRESHOLD
    ? Date.now() + Math.min(
      TARGET_EJECTION_MAX_MS,
      TARGET_EJECTION_BASE_MS * 2 ** (failures - TARGET_EJECTION_THRESHOLD)
    )
    : 0
  const health = { failures, ejectedUntil, lastFailureAt: Date.now() }
  targetHealth.set(key, health)
  pruneTargetHealth()
  persistTargetHealth(key, health)
}

function markTargetResponsive(
  match: ResolvedDynamicRoute,
  target: GatewayTarget
): void {
  const key = targetStateKey(match, target)
  targetHealth.delete(key)
  deletePersistedTargetHealth(key)
}

/** Record an active readiness/authentication probe in the same health state
 * used by passive Gateway failures. */
export function recordGatewayTargetAvailability(
  upstreamId: string,
  targetId: string,
  online: boolean
): void {
  const key = targetIdsStateKey(upstreamId, targetId)
  if (online) {
    targetHealth.delete(key)
    deletePersistedTargetHealth(key)
    return
  }

  const failures = Math.min((targetHealth.get(key)?.failures ?? 0) + 1, 31)
  const health: TargetHealth = {
    failures,
    ejectedUntil: failures >= TARGET_EJECTION_THRESHOLD
      ? Date.now() + Math.min(
        TARGET_EJECTION_MAX_MS,
        TARGET_EJECTION_BASE_MS * 2 ** (
          failures - TARGET_EJECTION_THRESHOLD
        )
      )
      : 0,
    lastFailureAt: Date.now()
  }
  targetHealth.set(key, health)
  pruneTargetHealth()
  persistTargetHealth(key, health)
}

export function resetGatewayTargetHealthForTarget(
  upstreamId: string,
  targetId: string
): void {
  const key = targetIdsStateKey(upstreamId, targetId)
  targetHealth.delete(key)
  deletePersistedTargetHealth(key)
}

export function resetGatewayTargetHealth(): void {
  targetHealth.clear()
  targetCounters.clear()
  healthHydration.clear()
  healthHydratedAt.clear()
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
        if (retryableStatus) markTargetUnavailable(input.match, target)
        else markTargetResponsive(input.match, target)

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
          input.onResponseBytes
        )
      } catch (error) {
        releaseAttempt()
        if (findGatewayExecutionError(error)) throw error
        // The client went away or the route budget expired: the target is
        // not at fault and no later attempt can succeed.
        if (overallSignal?.aborted) throw error
        markTargetUnavailable(input.match, target)
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
