import type { RateLimitWindow } from '~~/server/config/api-access'
import type { RateLimiter, RateLimitResult } from '~~/server/types/api-access'
import { getMemoryRateLimiter } from '~~/server/utils/rate-limit/memory'
import { getRedisRateLimiter } from '~~/server/utils/rate-limit/redis'
import { consumeMultiWindowAtomic } from '~~/server/utils/rate-limit/atomic-multi-window'
import { getRedisClient, getRedisConfig } from '~~/server/utils/redis'

export function getRateLimiter(): RateLimiter {
  const memoryRateLimiter = getMemoryRateLimiter()
  return getRedisRateLimiter(memoryRateLimiter) ?? memoryRateLimiter
}

/** Consume a subject's windows without exposing storage selection or retry
 * rules. Redis multi-window consumption is atomic; memory keeps the existing
 * sequential consumption and stops at the first denied window. */
export async function consumeRateLimitWindows(
  baseKey: string,
  windows: readonly { window: RateLimitWindow, limit: number }[]
): Promise<{ results: RateLimitResult[] } | { denied: RateLimitResult }> {
  const limits = windows.filter(item => item.limit > 0)
  if (limits.length === 0) return { results: [] }

  const client = getRedisClient()
  if (client && limits.length > 1) {
    // An EVAL reply may be lost after consumption. Never retry an ambiguous
    // result through another algorithm or adapter.
    const results = await consumeMultiWindowAtomic(client, getRedisConfig(), baseKey, limits)
    const denied = results.find(result => !result.allowed)
    return denied ? { denied } : { results }
  }

  const limiter = getRateLimiter()
  const results: RateLimitResult[] = []
  for (const { window, limit } of limits) {
    const result = await limiter.consume(`${baseKey}:${window}`, limit, window)
    if (!result.allowed) return { denied: result }
    results.push(result)
  }
  return { results }
}
