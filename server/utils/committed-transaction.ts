import { db, type DatabaseTransaction } from '~~/server/db/client'

const effectsByTransaction = new WeakMap<DatabaseTransaction, Array<() => void>>()

/** Only the owner of the outer transaction may run its cache/health effects. */
export async function withCommittedTransaction<T>(
  operation: (tx: DatabaseTransaction) => Promise<T>
): Promise<T> {
  const effects: Array<() => void> = []
  const value = await db.transaction(async (tx) => {
    effectsByTransaction.set(tx, effects)
    try {
      return await operation(tx)
    } finally {
      effectsByTransaction.delete(tx)
    }
  })
  for (const effect of effects) effect()
  return value
}

export function afterCommit(tx: DatabaseTransaction, effect: () => void): void {
  const effects = effectsByTransaction.get(tx)
  if (!effects) throw new Error('Commit effects require a transaction owned by withCommittedTransaction')
  effects.push(effect)
}
