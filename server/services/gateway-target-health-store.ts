import { getRedisClient, getRedisConfig } from '~~/server/utils/redis'

export interface TargetHealthState {
  /** Epoch microseconds with a process-local monotonic tie breaker. */
  observedAt: number
  failures: number
  ejectedUntil: number
}

export interface TargetHealthSnapshot {
  resetAt: number
  state: TargetHealthState | null
}

export interface TargetHealthStore {
  read: (key: string, targetKey: string) => Promise<TargetHealthSnapshot>
  write: (key: string, targetKey: string, state: TargetHealthState) => Promise<boolean>
  reset: (targetKey: string, resetAt: number) => Promise<void>
}

const TTL = 30 * 60_000
const MAX_ENTRIES = 10_000

/** The same ordering rules apply to the single-process and Redis adapters. */
export function createMemoryTargetHealthStore(): TargetHealthStore {
  const states = new Map<string, TargetHealthState>()
  const resets = new Map<string, number>()
  function trim<T>(map: Map<string, T>) {
    while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!)
  }
  function snapshot(key: string, targetKey: string): TargetHealthSnapshot {
    const state = states.get(key)
    const resetAt = resets.get(targetKey) ?? 0
    return {
      resetAt: resetAt / 1_000 + TTL > Date.now() ? resetAt : 0,
      state: state && state.observedAt / 1_000 + TTL > Date.now() ? { ...state } : null
    }
  }
  return {
    async read(key, targetKey) { return snapshot(key, targetKey) },
    async write(key, targetKey, state) {
      const current = snapshot(key, targetKey)
      if (state.observedAt <= Math.max(current.resetAt, current.state?.observedAt ?? 0)) return false
      states.set(key, { ...state })
      trim(states)
      return true
    },
    async reset(targetKey, resetAt) {
      resets.set(targetKey, Math.max(resetAt, resets.get(targetKey) ?? 0))
      trim(resets)
    }
  }
}

const READ = `
local raw = redis.call('GET', KEYS[1])
return cjson.encode({ resetAt = redis.call('GET', KEYS[2]) or '0', raw = raw or cjson.null })
`
const WRITE = `
local observed = tonumber(ARGV[1])
local reset = tonumber(redis.call('GET', KEYS[2])) or 0
if observed <= reset then return 0 end
local raw = redis.call('GET', KEYS[1])
if raw then
  local ok, state = pcall(cjson.decode, raw)
  if ok and type(state) == 'table' and tonumber(state.observedAt) and observed <= tonumber(state.observedAt) then return 0 end
end
redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
return 1
`
const RESET = `
local previous = tonumber(redis.call('GET', KEYS[1])) or 0
if tonumber(ARGV[1]) > previous then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
else
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 1
`

const memory = createMemoryTargetHealthStore()
function keys(key: string, targetKey: string) {
  const prefix = `${getRedisConfig().keyPrefix}gateway:target-health:v2:`
  return [`${prefix}${key}`, `${prefix}reset:${targetKey}`] as const
}

function parseState(raw: string | null): TargetHealthState | null {
  if (!raw) return null
  try {
    const state = JSON.parse(raw) as Partial<TargetHealthState>
    if (!Number.isSafeInteger(state.observedAt) || !Number.isSafeInteger(state.failures)
      || !Number.isFinite(state.ejectedUntil) || state.observedAt! < 1
      || state.failures! < 0 || state.failures! > 31 || state.ejectedUntil! < 0) return null
    return state as TargetHealthState
  } catch { return null }
}

export const targetHealthStore: TargetHealthStore = {
  async read(key, targetKey) {
    const redis = getRedisClient()
    if (!redis) return memory.read(key, targetKey)
    const result = JSON.parse(String(await redis.eval(READ, 2, ...keys(key, targetKey)))) as { resetAt: string, raw: string | null }
    return { resetAt: Number(result.resetAt), state: parseState(result.raw) }
  },
  async write(key, targetKey, state) {
    const redis = getRedisClient()
    if (!redis) return memory.write(key, targetKey, state)
    return await redis.eval(WRITE, 2, ...keys(key, targetKey), state.observedAt, JSON.stringify(state), TTL) === 1
  },
  async reset(targetKey, resetAt) {
    const redis = getRedisClient()
    if (!redis) return memory.reset(targetKey, resetAt)
    await redis.eval(RESET, 1, keys('', targetKey)[1], resetAt, TTL)
  }
}
