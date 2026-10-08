import type { H3Event } from 'h3'
import { getHeader, getRequestURL } from 'h3'
import type { ResolvedDynamicRoute } from '~~/server/services/routing-runtime-service'
import type { ApiCreditReservationContext, GateOutcome } from '~~/server/types/api-access'
import { apiCallService } from '~~/server/services/api-call-service'
import { apiKeyService } from '~~/server/services/api-key-service'
import { creditService } from '~~/server/services/credit-service'
import { BillingPersistenceError } from '~~/server/errors/gateway-error'
import { shouldChargeGatewayCall } from '~~/server/utils/gateway-billing'
import { getAppEventContext } from '~~/server/utils/event-context'
import { toNullableNonNegativeInteger } from '~~/server/utils/number'
import { ensureRequestId } from '~~/server/utils/request-id'
import { readRequestMeta } from '~~/server/utils/request-meta'
import { sanitizeQueryStringForLog, sanitizeUrlForLog } from '~~/server/utils/request-query'

interface Caller {
  id: number
  userId: number
  name: string
}

interface CallFailure {
  errorCode: string
  errorMessage: string | null
}

interface AccessRejection extends CallFailure {
  outcome: Exclude<GateOutcome, 'passed'>
}

interface CallStatistics {
  startedAt: number
  pathname: string
  method: string
  ip: string | null
  requestSize: number | null
  responseSize?: number
  userAgent: string | null
  referer: string | null
  queryString: string | null
}

interface GatewayCall {
  route: ResolvedDynamicRoute['route']
  statistics: CallStatistics | null
  target: { id: string, baseUrl: string } | null
  caller: Caller | null
  rejection: AccessRejection | null
  failure: CallFailure | null
  reservation: ApiCreditReservationContext | null
  pending: boolean
  release?: Promise<void>
  completion?: Promise<void>
}

// State belongs to one request and is never exposed through mutable event fields.
const calls = new WeakMap<H3Event, GatewayCall>()

const DO_NOT_WRITE_LOG_OUTCOMES = new Set<AccessRejection['outcome']>(['invalid_api_key', 'missing_api_key'])

function shouldCharge(call: GatewayCall, statusCode: number): boolean {
  return shouldChargeGatewayCall({
    costCredits: call.route.creditsCost,
    apiKeyUserId: call.caller?.userId ?? null,
    statusCode
  })
}

function releaseReservation(call: GatewayCall): Promise<void> {
  if (call.release) return call.release
  const reservation = call.reservation
  if (!reservation) return Promise.resolve()
  const release = async () => {
    const released = await creditService.releaseReservation(reservation.id, reservation.userId)
    if (!released) throw new Error('Billing reservation could not be released')
    call.reservation = null
    call.pending = false
  }
  // Failed releases remain retryable by afterResponse; successful releases are inert.
  call.release = release().finally(() => { call.release = undefined })
  return call.release
}

async function recordCall(event: H3Event, call: GatewayCall, statusCode: number): Promise<number | null> {
  const tracked = call.statistics
  if (!tracked) return null
  const context = getAppEventContext(event)
  const rejection = call.rejection
  if (rejection && DO_NOT_WRITE_LOG_OUTCOMES.has(rejection.outcome)) return null
  // Admission rejections take precedence over later failures and never count
  // as upstream calls. Failure details remain private once completion starts.
  const failure = rejection ?? call.failure
  const isCounted = !rejection
  const input = {
    routeId: call.route.id,
    routeName: call.route.name,
    upstreamTargetId: call.target?.id ?? null,
    upstreamTargetUrl: call.target?.baseUrl ?? null,
    apiKeyId: call.caller?.id ?? null,
    apiKeyName: call.caller?.name ?? null,
    userId: call.caller?.userId ?? null,
    requestId: context.requestId ?? null,
    path: tracked.pathname,
    method: tracked.method,
    statusCode,
    latencyMs: Math.max(Date.now() - tracked.startedAt, 0),
    ip: tracked.ip,
    userAgent: tracked.userAgent,
    referer: tracked.referer,
    queryString: tracked.queryString,
    requestSize: tracked.requestSize,
    responseSize: tracked.responseSize ?? toNullableNonNegativeInteger(
      event.node.res.getHeader('content-length') as string | string[] | number | undefined
    ),
    statDate: new Date(),
    errorCode: failure?.errorCode ?? null,
    errorMessage: failure?.errorMessage ?? null,
    creditsCost: 0,
    isCounted,
    statusCodeForStats: statusCode
  }
  return isCounted
    ? apiCallService.addCallAndUpsertDailyStat(input)
    : (await apiCallService.addCall(input))[0]?.id ?? null
}

async function completeCall(event: H3Event, call: GatewayCall): Promise<void> {
  const statusCode = Math.trunc(event.node.res.statusCode || 200)
  const willCharge = call.pending && shouldCharge(call, statusCode)
  try {
    const callId = await recordCall(event, call, statusCode)
    const reservation = call.reservation
    if (willCharge && reservation && callId) {
      try {
        await creditService.linkApiCall(reservation.id, callId)
        await creditService.finalizeReservation({
          reservationId: reservation.id,
          apiCallId: callId,
          remark: `API 调用扣费 · ${call.route.pathPattern}`
        })
        call.reservation = null
        call.pending = false
      } catch (error) {
        // A durable pending intent survives failed logging/settlement and is
        // recovered by the existing worker, without replaying the call record.
        console.error('failed to finalize billing reservation; background retry will continue', {
          callId,
          reservationId: reservation.id,
          userId: reservation.userId,
          amount: reservation.amount,
          error: error instanceof Error ? error.message : 'settlement failed'
        })
      }
    }
    if (call.statistics && call.caller && !call.rejection) {
      await apiKeyService.recordUsage(call.caller.id, call.statistics.ip)
    }
  } catch (error) {
    console.error('failed to record api call stats', {
      routeId: call.route.id,
      statusCode,
      error
    })
  } finally {
    if (!willCharge) {
      await releaseReservation(call).catch((error: unknown) => {
        console.error('failed to release credit reservation', {
          reservationId: call.reservation?.id,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }
  }
}

export const gatewayCallService = {
  start(event: H3Event, match: ResolvedDynamicRoute): void {
    if (calls.has(event)) return
    const requestUrl = getRequestURL(event)
    const meta = readRequestMeta(event)
    ensureRequestId(event)
    calls.set(event, {
      route: match.route,
      statistics: match.route.isStatistics ? {
        startedAt: Date.now(),
        pathname: requestUrl.pathname,
        method: event.method.toUpperCase(),
        ip: meta.ip,
        requestSize: toNullableNonNegativeInteger(getHeader(event, 'content-length')),
        userAgent: meta.userAgent?.slice(0, 500) || null,
        referer: sanitizeUrlForLog(
          getHeader(event, 'referer') || getHeader(event, 'referrer'),
          1_000,
          match.route.sensitiveQueryParameters
        ),
        queryString: sanitizeQueryStringForLog(requestUrl.search, 2_000, match.route.sensitiveQueryParameters)
      } : null,
      target: null,
      caller: null,
      rejection: null,
      failure: null,
      reservation: null,
      pending: false
    })
  },

  acceptAccess(event: H3Event, caller: Caller | null, reservation: ApiCreditReservationContext | null): void {
    const call = calls.get(event)
    if (!call) throw new Error('Gateway call must start before authorization')
    if (call.completion) return
    call.caller = caller ? { id: caller.id, userId: caller.userId, name: caller.name } : null
    call.reservation = reservation ? { ...reservation } : null
  },

  rejectAccess(event: H3Event, caller: Caller | null, rejection: AccessRejection): void {
    const call = calls.get(event)
    if (!call) throw new Error('Gateway call must start before authorization')
    if (call.completion) return
    call.caller = caller ? { id: caller.id, userId: caller.userId, name: caller.name } : null
    call.rejection = { ...rejection }
  },

  fail(event: H3Event, errorCode: string, errorMessage: string | null): void {
    const call = calls.get(event)
    // Routing and preflight failures have no call to record.
    if (!call || call.completion) return
    call.failure = { errorCode, errorMessage }
  },

  observe(event: H3Event, observation: {
    target?: { id: string, baseUrl: string }
    requestBytes?: number
    responseBytes?: number
  }): void {
    const call = calls.get(event)
    if (!call || call.completion) return
    if (observation.target) call.target = { id: observation.target.id, baseUrl: observation.target.baseUrl }
    if (!call.statistics) return
    if (observation.requestBytes !== undefined) call.statistics.requestSize = observation.requestBytes
    if (observation.responseBytes !== undefined) call.statistics.responseSize = observation.responseBytes
  },

  /** The stream limiter runs before this method. Paid success bytes may leave
   * only after the bounded body has arrived and its settlement intent is durable. */
  async prepareResponse(event: H3Event, response: Response, signal: AbortSignal): Promise<Response> {
    const call = calls.get(event)
    if (!call?.reservation) return response
    let prepared = response
    const charge = shouldCharge(call, response.status)
    if (charge && response.body) {
      prepared = new Response(await response.arrayBuffer(), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    }
    signal.throwIfAborted()
    try {
      if (!charge) {
        await releaseReservation(call)
      } else if (!call.pending) {
        const marked = await creditService.markReservationPending(call.reservation.id, call.reservation.userId)
        if (!marked) throw new Error('Billing reservation is no longer active')
        call.pending = true
      }
    } catch (error) {
      await prepared.body?.cancel().catch(() => undefined)
      throw new BillingPersistenceError(error)
    }
    signal.throwIfAborted()
    return prepared
  },

  release(event: H3Event): Promise<void> {
    const call = calls.get(event)
    return call ? releaseReservation(call) : Promise.resolve()
  },

  complete(event: H3Event): Promise<void> {
    const call = calls.get(event)
    if (!call) return Promise.resolve()
    // Retain the promise after completion: repeated hooks cannot log or charge twice.
    call.completion ??= completeCall(event, call)
    return call.completion
  }
}
