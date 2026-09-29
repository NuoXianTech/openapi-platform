import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DatabaseTransaction } from '~~/server/db/client'

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }))
vi.mock('~~/server/db/client', () => ({ db: { transaction: mocks.transaction } }))
const { afterCommit, withCommittedTransaction } = await import('~~/server/utils/committed-transaction')

describe('transaction-owned effects', () => {
  beforeEach(() => { mocks.transaction.mockReset() })

  it('waits for the database commit, not just the transaction callback', async () => {
    let commit!: () => void
    const committed = new Promise<void>(resolve => { commit = resolve })
    const effect = vi.fn()
    let operationFinished = false
    mocks.transaction.mockImplementation(async (operation: (tx: DatabaseTransaction) => Promise<string>) => {
      const value = await operation({} as DatabaseTransaction)
      operationFinished = true
      await committed
      return value
    })
    const result = withCommittedTransaction(async tx => { afterCommit(tx, effect); return 'saved' })
    await vi.waitFor(() => expect(operationFinished).toBe(true))
    expect(effect).not.toHaveBeenCalled()
    commit()
    await expect(result).resolves.toBe('saved')
    expect(effect).toHaveBeenCalledOnce()
  })

  it.each(['operation', 'commit'] as const)('discards effects after %s failure', async (failure) => {
    const effect = vi.fn()
    mocks.transaction.mockImplementation(async (operation: (tx: DatabaseTransaction) => Promise<void>) => {
      await operation({} as DatabaseTransaction)
      throw new Error('commit failed')
    })
    await expect(withCommittedTransaction(async tx => {
      afterCommit(tx, effect)
      if (failure === 'operation') throw new Error('operation failed')
    })).rejects.toThrow(`${failure} failed`)
    expect(effect).not.toHaveBeenCalled()
  })
})
