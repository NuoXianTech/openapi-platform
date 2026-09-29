interface SnapshotEntry<TValue> {
  snapshot?: { value: TValue, expiresAt: number }
  pending?: Promise<TValue>
}

/** Process-local snapshots. Entry identity is the generation: detached reads
 * may finish for their callers, but cannot publish into or clear a newer entry. */
export function createLocalSnapshot<TKey, TValue>(options: {
  ttlMs: number
  maxEntries: number
  load: (key: TKey, previous: TValue | undefined) => Promise<TValue>
  now?: () => number
}) {
  const entries = new Map<TKey, SnapshotEntry<TValue>>()
  const now = options.now ?? (() => Date.now())
  if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1) {
    throw new Error('Snapshot capacity must be a positive integer')
  }

  function install(key: TKey, entry: SnapshotEntry<TValue>): void {
    entries.delete(key)
    entries.set(key, entry)
    while (entries.size > options.maxEntries) {
      const oldest = entries.keys().next()
      if (!oldest.done) entries.delete(oldest.value)
    }
  }

  function get(key: TKey): Promise<TValue> {
    let entry = entries.get(key)
    if (entry?.snapshot && entry.snapshot.expiresAt > now()) {
      return Promise.resolve(entry.snapshot.value)
    }
    if (entry?.pending) return entry.pending
    if (!entry) {
      entry = {}
      install(key, entry)
    }
    const current = entry
    const pending = Promise.resolve().then(() => options.load(key, current.snapshot?.value))
      .then((value) => {
        if (entries.get(key) === current) {
          current.snapshot = { value, expiresAt: now() + options.ttlMs }
        }
        return value
      }).finally(() => {
        if (current.pending === pending) current.pending = undefined
      })
    current.pending = pending
    return pending
  }

  return {
    get,
    replace(key: TKey, value: TValue): void {
      install(key, { snapshot: { value, expiresAt: now() + options.ttlMs } })
    },
    invalidate(key: TKey, options: { keepStale?: boolean } = {}): void {
      const previous = entries.get(key)?.snapshot
      if (options.keepStale && previous) {
        install(key, { snapshot: { value: previous.value, expiresAt: Number.NEGATIVE_INFINITY } })
      } else {
        entries.delete(key)
      }
    },
    clear(): void {
      entries.clear()
    }
  }
}
