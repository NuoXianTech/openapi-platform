import type { RateLimitWindow } from '../config/api-access'

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAtMs: number
  limit: number
  window: RateLimitWindow
}

export interface RateLimiter {
  readonly name: 'memory' | 'redis'
  consume(key: string, limit: number, window: RateLimitWindow): Promise<RateLimitResult>
}

export type GateOutcome
  = | 'passed'
    | 'missing_api_key'
    | 'invalid_api_key'
    | 'disabled_api_key'
    | 'expired_api_key'
    | 'scope_denied'
    | 'ip_denied'
    | 'rate_limited'
    | 'rate_limit_unavailable'
    | 'api_key_quota_exceeded'
    | 'credits_unavailable'
    | 'insufficient_credits'

export interface ApiCreditReservationContext {
  id: number
  userId: number
  amount: number
}

export interface AppEventContext {
  requestId?: string
  publicRequestProtocol?: 'http' | 'https'
}
