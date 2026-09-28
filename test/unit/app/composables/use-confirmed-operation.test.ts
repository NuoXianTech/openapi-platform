import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConfirmedOperation } from '~/composables/use-confirmed-operation'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function setup() {
  const dialogs: Array<{ callback: () => Promise<void> | void, answer: ReturnType<typeof deferred<boolean>> }> = []
  vi.stubGlobal('useConfirmDialog', () => (options: { onConfirm: () => Promise<void> | void }) => {
    const answer = deferred<boolean>()
    dialogs.push({ callback: options.onConfirm, answer })
    return answer.promise
  })
  const context = ref('first')
  const scope = effectScope()
  const confirm = scope.run(() => useConfirmedOperation(() => context.value))!
  const operation = { mutate: vi.fn(async () => {}), onSuccess: vi.fn(async () => {}), onError: vi.fn() }
  return { scope, context, confirm, dialogs, operation }
}

afterEach(() => vi.unstubAllGlobals())

describe('confirmed operation lifecycle', () => {
  it('shares one request through post-commit work and never replays a completed mutation', async () => {
    const { scope, confirm, dialogs, operation } = setup()
    const read = deferred<undefined>()
    operation.onSuccess.mockReturnValue(read.promise)
    const pending = confirm(operation)
    const dialog = dialogs[0]!
    const first = dialog.callback()
    await vi.waitFor(() => expect(operation.onSuccess).toHaveBeenCalledOnce())
    expect(dialog.callback()).toBe(first)
    read.resolve(undefined)
    await first
    await dialog.callback()
    dialog.answer.resolve(true)
    await expect(pending).resolves.toBe(true)
    expect(operation.mutate).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('keeps a failed mutation retryable in the same confirmation', async () => {
    const { scope, confirm, dialogs, operation } = setup()
    operation.mutate.mockRejectedValueOnce(new Error('rejected'))
    const pending = confirm(operation)
    const dialog = dialogs[0]!
    await expect(dialog.callback()).rejects.toThrow('rejected')
    expect(operation.onSuccess).not.toHaveBeenCalled()
    expect(operation.onError).toHaveBeenCalledOnce()
    await dialog.callback()
    dialog.answer.resolve(true)
    await expect(pending).resolves.toBe(true)
    expect(operation.mutate).toHaveBeenCalledTimes(2)
    scope.stop()
  })

  it.each(['cancel', 'dispose', 'context'] as const)('invalidates retained callbacks after %s', async (reason) => {
    const { scope, context, confirm, dialogs, operation } = setup()
    const pending = confirm(operation)
    const dialog = dialogs[0]!
    if (reason === 'cancel') { dialog.answer.resolve(false); await pending }
    if (reason === 'dispose') scope.stop()
    if (reason === 'context') { context.value = 'second'; context.value = 'first' }
    await dialog.callback()
    dialog.answer.resolve(true)
    await expect(pending).resolves.toBe(false)
    expect(operation.mutate).not.toHaveBeenCalled()
    scope.stop()
  })

  it('does not apply old results or release a new confirmation after a context switch', async () => {
    const { scope, context, confirm, dialogs, operation } = setup()
    const request = deferred<undefined>()
    operation.mutate.mockReturnValueOnce(request.promise)
    const old = confirm(operation)
    const oldSending = dialogs[0]!.callback()
    context.value = 'second'
    const current = confirm(operation)
    request.resolve(undefined)
    await oldSending
    dialogs[0]!.answer.resolve(true)
    await expect(old).resolves.toBe(false)
    expect(operation.onSuccess).not.toHaveBeenCalled()
    await dialogs[1]!.callback()
    dialogs[1]!.answer.resolve(true)
    await expect(current).resolves.toBe(true)
    expect(operation.onSuccess).toHaveBeenCalledOnce()
    scope.stop()
  })

  it('does not repeat the mutation when post-commit handling fails', async () => {
    const { scope, confirm, dialogs, operation } = setup()
    operation.onSuccess.mockRejectedValueOnce(new Error('read failed'))
    const pending = confirm(operation)
    await expect(dialogs[0]!.callback()).rejects.toThrow('read failed')
    await dialogs[0]!.callback()
    dialogs[0]!.answer.resolve(true)
    await expect(pending).resolves.toBe(true)
    expect(operation.mutate).toHaveBeenCalledOnce()
    expect(operation.onError).not.toHaveBeenCalled()
    scope.stop()
  })
})
