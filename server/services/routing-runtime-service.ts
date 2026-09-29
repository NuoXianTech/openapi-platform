import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '~~/server/db/client'
import { platformRuntime, routingRevisions } from '~~/server/db/schema'
import type {
  RoutingRevisionPayload,
  RoutingRevisionRoute,
  RoutingRevisionUpstream
} from '~~/server/types/routing-revision'
import { canonicalJson } from '~~/server/utils/canonical-json'
import {
  matchRoutePath,
  normalizeRouteHost,
  parseRoutePathPattern,
  routeHostMatches,
  type ParsedRoutePattern
} from '~~/server/utils/route-pattern'
import { findRoutingRouteConflict } from '~~/server/utils/routing-conflict'
import { createLocalSnapshot } from '~~/server/utils/local-snapshot'

const CACHE_TTL_MS = 1_000
// A previously verified snapshot may continue serving traffic during a short
// database outage, but it must not become an unbounded, silently stale
// configuration.  Once this window elapses the Gateway fails closed with a
// stable 503 instead of misreporting every request as a 404.
const MAX_STALE_RUNTIME_MS = 60_000
const HTTP_METHOD_ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

export class RoutingRuntimeUnavailableError extends Error {
  readonly statusCode = 503
  readonly code = 'ROUTING_RUNTIME_UNAVAILABLE'

  constructor(cause?: unknown) {
    super('active routing runtime is temporarily unavailable', cause === undefined ? undefined : { cause })
    this.name = 'RoutingRuntimeUnavailableError'
  }
}

interface CompiledRoute {
  definition: RoutingRevisionRoute
  parsedPath: ParsedRoutePattern
  hosts: string[]
}

interface CompiledRuntime {
  defaultDomain: string | null
  revisionId: string
  routes: CompiledRoute[]
  upstreams: Map<string, RoutingRevisionUpstream>
}

export interface ResolvedDynamicRoute {
  revisionId: string
  route: RoutingRevisionRoute
  upstream: RoutingRevisionUpstream
  params: Record<string, string>
}

interface RuntimeSnapshot {
  runtime: CompiledRuntime | null
  verifiedAt: number
}

let lastRuntimeFailureLogAt = 0

export function invalidateRoutingRuntimeCache(): void {
  runtimeSnapshot.invalidate('runtime', { keepStale: true })
}

function validateChecksum(payload: RoutingRevisionPayload, checksum: string): void {
  const actual = createHash('sha256').update(canonicalJson(payload)).digest('hex')
  if (actual !== checksum) throw new Error(`routing revision checksum mismatch: ${payload.revisionId}`)
}

function compileRuntime(input: {
  defaultDomain: string | null
  revisionId: string
  checksum: string
  payload: RoutingRevisionPayload
}): CompiledRuntime {
  const { payload } = input
  if (payload.schemaVersion !== 1) throw new Error(`unsupported routing schema: ${payload.schemaVersion}`)
  if (payload.revisionId !== input.revisionId) {
    throw new Error('routing revision identity mismatch')
  }
  validateChecksum(payload, input.checksum)

  const upstreams = new Map(payload.upstreams.map(upstream => [upstream.id, upstream]))
  const routes = payload.routes.map((route): CompiledRoute => {
    const parsedPath = parseRoutePathPattern(route.pathPattern)
    if (parsedPath.normalizedShape !== route.normalizedShape) {
      throw new Error(`route normalized shape mismatch: ${route.id}`)
    }
    if (!upstreams.has(route.upstreamServiceId)) {
      throw new Error(`route references missing upstream: ${route.id}`)
    }
    return {
      definition: route,
      parsedPath,
      hosts: route.hosts.map(normalizeRouteHost)
    }
  }).sort((left, right) => (
    right.parsedPath.specificity - left.parsedPath.specificity
    || left.definition.pathPattern.localeCompare(right.definition.pathPattern)
    || left.definition.id.localeCompare(right.definition.id)
  ))

  const defaultDomain = payload.defaultDomain === undefined
    ? input.defaultDomain
    : payload.defaultDomain

  return {
    defaultDomain: defaultDomain ? normalizeRouteHost(defaultDomain) : null,
    revisionId: input.revisionId,
    routes,
    upstreams
  }
}

async function loadCompiledRuntime(): Promise<CompiledRuntime | null> {
  const [row] = await db.select({
    defaultDomain: platformRuntime.defaultDomain,
    revisionId: routingRevisions.id,
    checksum: routingRevisions.checksum,
    payload: routingRevisions.configPayload
  }).from(platformRuntime)
    .innerJoin(routingRevisions, eq(routingRevisions.id, platformRuntime.activeRevisionId))
    .limit(1)
  if (!row) return null

  const compiled = compileRuntime(row)
  const conflict = findRoutingRouteConflict(
    compiled.routes.map(route => route.definition),
    compiled.defaultDomain
  )
  if (conflict) {
    throw new Error(`active routing revision conflicts: ${JSON.stringify(conflict)}`)
  }
  return compiled
}

const runtimeSnapshot = createLocalSnapshot<string, RuntimeSnapshot>({
  ttlMs: CACHE_TTL_MS,
  maxEntries: 1,
  async load(_key, previous) {
    try {
      return { runtime: await loadCompiledRuntime(), verifiedAt: Date.now() }
    } catch (error) {
      const now = Date.now()
      if (previous?.runtime && previous.verifiedAt + MAX_STALE_RUNTIME_MS > now) {
        if (now - lastRuntimeFailureLogAt >= 10_000) {
          lastRuntimeFailureLogAt = now
          console.error('[gateway] Failed to load the active routing revision; serving the last valid runtime temporarily.', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
        // Preserve the last successful verification time across fallback reads.
        return previous
      }
      if (now - lastRuntimeFailureLogAt >= 10_000) {
        lastRuntimeFailureLogAt = now
        console.error('[gateway] Active routing runtime is unavailable.', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
      throw new RoutingRuntimeUnavailableError(error)
    }
  }
})

async function getCompiledRuntime(): Promise<CompiledRuntime | null> {
  const snapshot = await runtimeSnapshot.get('runtime')
  // A cached fallback must not extend the 60-second window by another TTL.
  if (snapshot.runtime && snapshot.verifiedAt + MAX_STALE_RUNTIME_MS <= Date.now()) {
    throw new RoutingRuntimeUnavailableError()
  }
  return snapshot.runtime
}

function routeHostSpecificity(
  route: CompiledRoute,
  defaultDomain: string | null,
  requestHost: string
): number {
  const hosts = route.hosts.length > 0
    ? route.hosts
    : defaultDomain
      ? [defaultDomain]
      : []
  if (hosts.length === 0) return 0

  let best = -1
  for (const host of hosts) {
    if (!routeHostMatches(host, requestHost)) continue
    const specificity = host.startsWith('*.')
      ? 1_000_000 + host.length
      : 2_000_000 + host.length
    best = Math.max(best, specificity)
  }
  return best
}

interface ResolvedCandidate {
  route: CompiledRoute
  params: Record<string, string>
  hostSpecificity: number
  methodSpecificity: number
}

function candidateOutranks(left: ResolvedCandidate, right: ResolvedCandidate): boolean {
  if (left.hostSpecificity !== right.hostSpecificity) return left.hostSpecificity > right.hostSpecificity
  if (left.route.parsedPath.specificity !== right.route.parsedPath.specificity) {
    return left.route.parsedPath.specificity > right.route.parsedPath.specificity
  }
  if (left.methodSpecificity !== right.methodSpecificity) return left.methodSpecificity > right.methodSpecificity
  const pathOrder = left.route.definition.pathPattern.localeCompare(right.route.definition.pathPattern)
  if (pathOrder !== 0) return pathOrder < 0
  return left.route.definition.id.localeCompare(right.route.definition.id) < 0
}

export const routingRuntimeService = {
  async resolveAllowedMethods(pathname: string, requestHost: string): Promise<string[]> {
    const runtime = await getCompiledRuntime()
    if (!runtime) return []
    const methods = new Set<string>()

    for (const route of runtime.routes) {
      if (routeHostSpecificity(route, runtime.defaultDomain, requestHost) < 0) continue
      if (!matchRoutePath(route.parsedPath, pathname)) continue
      methods.add(route.definition.method)
      if (route.definition.method === 'GET') methods.add('HEAD')
    }

    return HTTP_METHOD_ORDER.filter(method => methods.has(method))
  },

  async resolve(method: string, pathname: string, requestHost: string): Promise<ResolvedDynamicRoute | null> {
    const runtime = await getCompiledRuntime()
    if (!runtime) return null
    const normalizedMethod = method.toUpperCase()
    let best: ResolvedCandidate | null = null

    for (const route of runtime.routes) {
      if (route.definition.method !== normalizedMethod && !(normalizedMethod === 'HEAD' && route.definition.method === 'GET')) continue
      const hostSpecificity = routeHostSpecificity(route, runtime.defaultDomain, requestHost)
      if (hostSpecificity < 0) continue
      const match = matchRoutePath(route.parsedPath, pathname)
      if (!match) continue
      const candidate: ResolvedCandidate = {
        route,
        params: match.params,
        hostSpecificity,
        methodSpecificity: route.definition.method === normalizedMethod ? 1 : 0
      }
      if (!best || candidateOutranks(candidate, best)) best = candidate
    }
    if (!best) return null
    return {
      revisionId: runtime.revisionId,
      route: best.route.definition,
      upstream: runtime.upstreams.get(best.route.definition.upstreamServiceId)!,
      params: best.params
    }
  }
}
