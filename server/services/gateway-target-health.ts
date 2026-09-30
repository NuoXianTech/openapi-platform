import { createHash } from 'node:crypto'
import { targetHealthStore, type TargetHealthState, type TargetHealthStore } from './gateway-target-health-store'

interface TargetIdentity { id: string, baseUrl: string }
interface HealthEntry {
  targetKey: string
  key: string
  state: TargetHealthState
  resetAt: number
  loadedAt: number
  touchedAt: number
  pending?: Promise<void>
}
interface Observation {
  readonly startedAt: number
}

const MAX_ENTRIES = 10_000
const MAX_AGE = 30 * 60_000
const READ_INTERVAL = 5_000
const READ_BUDGET = 100

/** Owns observation ordering, reset fences and advisory shared-state reads. */
export function createGatewayTargetHealth(store: TargetHealthStore = targetHealthStore) {
  const entries = new Map<string, HealthEntry>()
  const observations = new WeakMap<Observation, { entry: HealthEntry, observedAt: number }>()
  const warnings = new Set<string>()
  let clock = 0
  // Microsecond ordering leaves room for same-millisecond requests without
  // pushing a busy instance's observations seconds ahead of another instance.
  const tick = () => (clock = Math.max(Date.now() * 1_000, clock + 1))

  function warn(operation: string, error: unknown) {
    if (warnings.has(operation)) return
    warnings.add(operation)
    console.warn('[gateway] shared target health state unavailable; using local state', {
      operation, error: error instanceof Error ? error.message : String(error)
    })
  }

  function entryFor(upstreamId: string, target: TargetIdentity) {
    const targetKey = `${upstreamId}:${target.id}`
    // An old address must never contribute health observations to its replacement.
    const key = `${targetKey}:${createHash('sha256').update(target.baseUrl).digest('hex')}`
    let entry = entries.get(key)
    if (entry?.state.observedAt && entry.state.observedAt / 1_000 + MAX_AGE < Date.now()) {
      entries.delete(key)
      entry = undefined
    }
    if (!entry) {
      for (const [key, value] of entries) {
        if (value.touchedAt + MAX_AGE < Date.now() && !value.pending) entries.delete(key)
      }
      while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!)
      entry = { targetKey, key, resetAt: 0, loadedAt: 0, touchedAt: Date.now(), state: { observedAt: 0, failures: 0, ejectedUntil: 0 } }
      entries.set(key, entry)
    }
    entry.touchedAt = Date.now()
    return entry
  }

  function load(entry: HealthEntry): Promise<void> {
    if (entry.pending) return entry.pending
    if (entry.loadedAt + READ_INTERVAL > Date.now()) return Promise.resolve()
    const before = entry.state
    const task = (async () => {
      try {
        const snapshot = await store.read(entry.key, entry.targetKey)
        if (entries.get(entry.key) !== entry || entry.state !== before) return
        entry.resetAt = Math.max(entry.resetAt, snapshot.resetAt)
        const next = snapshot.state && snapshot.state.observedAt > entry.resetAt
          ? snapshot.state
          : { observedAt: entry.resetAt, failures: 0, ejectedUntil: 0 }
        if (next.observedAt >= entry.state.observedAt) entry.state = next
        clock = Math.max(clock, entry.state.observedAt)
        entry.loadedAt = Date.now()
      } catch (error) { warn('read', error) }
    })()
    entry.pending = task
    void task.finally(() => { if (entry.pending === task) entry.pending = undefined })
    return task
  }

  function begin(upstreamId: string, target: TargetIdentity): Observation {
    const entry = entryFor(upstreamId, target)
    const observation = Object.freeze({ startedAt: tick() })
    observations.set(observation, { entry, observedAt: observation.startedAt })
    return observation
  }

  function report(observation: Observation, online: boolean): void {
    const pending = observations.get(observation)
    if (!pending) return
    observations.delete(observation)
    const { entry, observedAt } = pending
    if (entries.get(entry.key) !== entry || observedAt <= Math.max(entry.resetAt, entry.state.observedAt)) return
    const failures = online ? 0 : Math.min(entry.state.failures + 1, 31)
    const state = {
      observedAt, failures,
      ejectedUntil: failures >= 2 ? Date.now() + Math.min(5 * 60_000, 15_000 * 2 ** (failures - 2)) : 0
    }
    // Keep healthy observations as tombstones: a delayed read cannot resurrect a failure.
    entry.state = state
    void store.write(entry.key, entry.targetKey, state).then((accepted) => {
      if (!accepted && entries.get(entry.key) === entry && entry.state === state) {
        entry.loadedAt = 0
        return load(entry)
      }
    }).catch(error => warn('write', error))
  }

  function reset(upstreamId: string, targetId: string): void {
    const targetKey = `${upstreamId}:${targetId}`
    const resetAt = tick()
    for (const [key, entry] of entries) {
      if (entry.targetKey === targetKey) entries.delete(key)
    }
    void store.reset(targetKey, resetAt).catch(error => warn('reset', error))
  }

  async function hydrate(upstreamId: string, targets: readonly TargetIdentity[]): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all(targets.map(target => load(entryFor(upstreamId, target)))),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, READ_BUDGET) })
      ])
    } finally { clearTimeout(timer) }
  }

  return {
    begin, report, reset, hydrate,
    available<T extends TargetIdentity>(upstreamId: string, targets: readonly T[]): T[] {
      return targets.filter(target => entryFor(upstreamId, target).state.ejectedUntil <= Date.now())
    },
    clear() { entries.clear(); warnings.clear() }
  }
}

export const gatewayTargetHealth = createGatewayTargetHealth()
