import type { H3Event } from 'h3'
import { getHeader, getQuery, setResponseHeaders } from 'h3'
import { and, eq, lte, or } from 'drizzle-orm'
import { db } from '~~/server/db/client'
import { apiKeys, users } from '~~/server/db/schema'
import { API_ACCESS_ERROR } from '~~/server/config/api-access'
import { creditService } from '~~/server/services/credit-service'
import { gatewayCallService } from '~~/server/services/dynamic-gateway-call-service'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'
import type { ApiCreditReservationContext, GateOutcome, RateLimitResult } from '~~/server/types/api-access'
import { getAppEventContext } from '~~/server/utils/event-context'
import { gatewayFail, type GatewayResponse } from '~~/server/utils/gateway-response'
import { consumeRateLimitWindows } from '~~/server/utils/rate-limit'
import { isRedisUnavailableError } from '~~/server/utils/redis'
import { ensureRequestId } from '~~/server/utils/request-id'
import { readClientIp, toClientIpRateLimitValue } from '~~/server/utils/request-meta'
import { readQueryString } from '~~/server/utils/request-query'
import { firstRow } from '~~/server/utils/row'
import { digestStoredSecret } from '~~/server/utils/stored-secret'
import { ipInAnyCidr } from '#shared/utils/cidr'

type ApiKeyRecord = Pick<
  typeof apiKeys.$inferSelect,
  'id' | 'userId' | 'name' | 'isActive' | 'expiresAt' | 'scopes' | 'ipWhitelist'
>

type DynamicAccessResult
  = { passed: true }
    | { passed: false, response: GatewayResponse }

interface AccessRejection {
  outcome: GateOutcome
  error: { status: number, code: string, msg: string }
  apiKey: ApiKeyRecord | null
  headers?: Record<string, string>
  detail?: Record<string, unknown>
}

function readApiKey(event: H3Event): string {
  const header = String(getHeader(event, 'x-api-key') ?? '').trim()
  return header || readQueryString(getQuery(event).apikey).trim()
}

async function loadApiKey(rawKey: string): Promise<ApiKeyRecord | null> {
  if (!rawKey) return null
  return firstRow(await db.select({
    id: apiKeys.id,
    userId: apiKeys.userId,
    name: apiKeys.name,
    isActive: apiKeys.isActive,
    expiresAt: apiKeys.expiresAt,
    scopes: apiKeys.scopes,
    ipWhitelist: apiKeys.ipWhitelist
  }).from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(
      eq(apiKeys.keyDigest, digestStoredSecret(rawKey, 'api-key')),
      eq(users.isActive, true),
      or(
        eq(users.isBanned, false),
        lte(users.bannedUntil, new Date())
      )
    ))
    .limit(1)) ?? null
}

function scopeCandidates(match: ResolvedDynamicRoute): string[] {
  return [
    '*',
    `route:${match.route.id}`,
    `product:${match.route.productSlug}`,
    `${match.route.productSlug}.${match.route.version}`,
    match.route.productSlug
  ]
}

function hasScope(scopes: string[] | null | undefined, match: ResolvedDynamicRoute): boolean {
  if (!scopes || scopes.length === 0) return true
  const allowed = new Set(scopeCandidates(match))
  return scopes.some(scope => allowed.has(scope))
}

function rateLimitHeaders(results: RateLimitResult[]): Record<string, string> {
  if (results.length === 0) return {}
  const primary = results.reduce((lowest, current) => (
    current.remaining < lowest.remaining ? current : lowest
  ))
  return {
    'X-RateLimit-Limit': String(primary.limit),
    'X-RateLimit-Remaining': String(Math.max(primary.remaining, 0)),
    'X-RateLimit-Reset': String(Math.ceil(primary.resetAtMs / 1000)),
    'X-RateLimit-Window': primary.window
  }
}

function reject(event: H3Event, rejection: AccessRejection): DynamicAccessResult {
  const context = getAppEventContext(event)
  context.apiGateRejection = {
    outcome: rejection.outcome,
    errorCode: rejection.error.code,
    errorMessage: rejection.error.msg,
    apiKeyId: rejection.apiKey?.id ?? null,
    apiKeyName: rejection.apiKey?.name ?? null,
    apiKeyUserId: rejection.apiKey?.userId ?? null
  }
  if (rejection.headers) setResponseHeaders(event, rejection.headers)
  return {
    passed: false,
    response: gatewayFail(
      event,
      rejection.error.status,
      rejection.error.code,
      rejection.error.msg,
      rejection.detail ?? null
    )
  }
}

async function reserveCredits(
  event: H3Event,
  match: ResolvedDynamicRoute,
  apiKey: ApiKeyRecord
): Promise<ApiCreditReservationContext | AccessRejection | null> {
  if (match.route.creditsCost <= 0) return null
  try {
    const result = await creditService.reserve({
      userId: apiKey.userId,
      apiKeyId: apiKey.id,
      routeId: match.route.id,
      requestId: ensureRequestId(event),
      amount: match.route.creditsCost
    })
    if (result.status === 'account_unavailable') {
      return {
        outcome: 'disabled_api_key',
        error: API_ACCESS_ERROR.DISABLED_API_KEY,
        apiKey
      }
    }
    if (result.status === 'insufficient_credits') {
      return {
        outcome: 'insufficient_credits',
        error: API_ACCESS_ERROR.INSUFFICIENT_CREDITS,
        apiKey
      }
    }
    if (result.status === 'api_key_quota_exceeded') {
      return {
        outcome: 'api_key_quota_exceeded',
        error: API_ACCESS_ERROR.API_KEY_QUOTA_EXCEEDED,
        apiKey
      }
    }
    return result.reservation
  } catch (error) {
    console.error('[gateway] billing reservation failed', {
      routeId: match.route.id,
      error: (error as Error).message
    })
    return {
      outcome: 'credits_unavailable',
      error: API_ACCESS_ERROR.CREDITS_UNAVAILABLE,
      apiKey
    }
  }
}

export const dynamicGatewayAccessService = {
  async authorize(event: H3Event, match: ResolvedDynamicRoute): Promise<DynamicAccessResult> {
    const requiresApiKey = match.route.isApiKey || match.route.creditsCost > 0
    const rawKey = requiresApiKey ? readApiKey(event) : ''
    const clientIp = readClientIp(event)
    let apiKey: ApiKeyRecord | null = null

    if (rawKey) {
      apiKey = await loadApiKey(rawKey)
      if (!apiKey) {
        return reject(event, {
          outcome: 'invalid_api_key',
          error: API_ACCESS_ERROR.INVALID_API_KEY,
          apiKey: null
        })
      }
      if (!apiKey.isActive) {
        return reject(event, {
          outcome: 'disabled_api_key',
          error: API_ACCESS_ERROR.DISABLED_API_KEY,
          apiKey
        })
      }
      const expiresAt = apiKey.expiresAt ? new Date(apiKey.expiresAt).getTime() : null
      if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
        const expiresAtISO = new Date(expiresAt).toISOString()
        return reject(event, {
          outcome: 'expired_api_key',
          error: {
            ...API_ACCESS_ERROR.EXPIRED_API_KEY,
            msg: `API Key expired at ${expiresAtISO}`
          },
          detail: { expiresAt: expiresAtISO },
          apiKey
        })
      }
      if (!hasScope(apiKey.scopes, match)) {
        return reject(event, {
          outcome: 'scope_denied',
          error: API_ACCESS_ERROR.SCOPE_DENIED,
          apiKey
        })
      }
      if (!ipInAnyCidr(clientIp, apiKey.ipWhitelist)) {
        return reject(event, {
          outcome: 'ip_denied',
          error: API_ACCESS_ERROR.IP_DENIED,
          apiKey
        })
      }
    } else if (requiresApiKey) {
      return reject(event, {
        outcome: 'missing_api_key',
        error: API_ACCESS_ERROR.MISSING_API_KEY,
        apiKey: null
      })
    }

    const subject = apiKey
      ? `apikey:${apiKey.id}`
      : `ip:${toClientIpRateLimitValue(clientIp)}`
    let rateLimits: Awaited<ReturnType<typeof consumeRateLimitWindows>>
    try {
      rateLimits = await consumeRateLimitWindows(`route:${match.route.id}:${subject}`, [
        { window: 'second', limit: match.route.rateLimitPerSecond },
        { window: 'minute', limit: match.route.rateLimitPerMinute },
        { window: 'hour', limit: match.route.rateLimitPerHour },
        { window: 'day', limit: match.route.rateLimitPerDay }
      ])
    } catch (error) {
      if (!isRedisUnavailableError(error)) throw error
      return reject(event, {
        outcome: 'rate_limit_unavailable',
        error: API_ACCESS_ERROR.RATE_LIMIT_UNAVAILABLE,
        apiKey
      })
    }
    if ('denied' in rateLimits) {
      return reject(event, {
        outcome: 'rate_limited',
        error: API_ACCESS_ERROR.RATE_LIMITED,
        apiKey,
        headers: {
          ...rateLimitHeaders([rateLimits.denied]),
          'Retry-After': String(Math.max(
            Math.ceil((rateLimits.denied.resetAtMs - Date.now()) / 1000),
            1
          ))
        }
      })
    }

    const reservation = apiKey
      ? await reserveCredits(event, match, apiKey)
      : null
    if (reservation && 'outcome' in reservation) return reject(event, reservation)

    gatewayCallService.acceptAccess(event, apiKey, reservation)
    const headers = rateLimitHeaders(rateLimits.results)
    if (Object.keys(headers).length > 0) setResponseHeaders(event, headers)
    return { passed: true }
  }
}
