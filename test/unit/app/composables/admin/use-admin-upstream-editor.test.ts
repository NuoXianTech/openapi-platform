import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAdminUpstreamEditor, type UpstreamFormValues } from '~/composables/admin/use-admin-upstream-editor'

const fetchMock = vi.fn()
const toast = vi.fn()
let scope = effectScope()
const input: UpstreamFormValues = {
  name: ' Updated ', slug: ' updated ', serviceToken: ' replacement-token-with-at-least-32-characters ',
  loadBalancing: 'round_robin', targets: [{ baseUrl: ' http://127.0.0.1:8080 ', weight: 1 }]
}
function setup(initialId: string | undefined = 'upstream-a') {
  const id = ref(initialId)
  const open = ref(true)
  const editor = scope.run(() => useAdminUpstreamEditor({ id: () => id.value, open: () => open.value }))!
  return { id, open, editor }
}
beforeEach(() => {
  scope = effectScope()
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('useToast', () => ({ add: toast }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  fetchMock.mockResolvedValue({})
})
afterEach(() => { scope.stop(); vi.resetAllMocks(); vi.unstubAllGlobals() })

describe('Upstream editor', () => {
  it('submits one mutation containing both metadata and the optional Token', async () => {
    const { editor } = setup()
    await expect(editor.save(input)).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/admin/v1/upstreams/upstream-a', {
      method: 'PATCH', body: { name: 'Updated', slug: 'updated', loadBalancing: 'round_robin', serviceToken: input.serviceToken.trim() }
    })
    expect(toast).toHaveBeenCalledOnce()
  })

  it('omits a blank Token on edits and includes initial Targets on creation', async () => {
    const { editor, id } = setup()
    await editor.save({ ...input, serviceToken: ' ' })
    expect(fetchMock.mock.calls[0]![1].body).not.toHaveProperty('serviceToken')
    id.value = undefined
    await editor.save(input)
    expect(fetchMock.mock.calls[1]).toEqual(['/api/admin/v1/upstreams', {
      method: 'POST', body: { name: 'Updated', slug: 'updated', loadBalancing: 'round_robin', serviceToken: input.serviceToken.trim(), targets: [{ baseUrl: 'http://127.0.0.1:8080', weight: 1 }] }
    }])
  })

  it('keeps a failed save retryable without reporting success', async () => {
    const { editor } = setup()
    fetchMock.mockRejectedValueOnce(new Error('save rejected'))
    await expect(editor.save(input)).resolves.toBe(false)
    expect(editor.formError.value).toBe('save rejected')
    expect(toast).not.toHaveBeenCalled()
    await expect(editor.save(input)).resolves.toBe(true)
    expect(editor.formError.value).toBeNull()
  })

  it.each(['switch', 'close', 'dispose'] as const)('ignores a pending response after %s', async (change) => {
    const { editor, id, open } = setup()
    let finish!: () => void
    fetchMock.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve }))
    const pending = editor.save(input)
    await expect(editor.save(input)).resolves.toBe(false)
    if (change === 'switch') id.value = 'upstream-b'
    if (change === 'close') open.value = false
    if (change === 'dispose') scope.stop()
    finish()
    await expect(pending).resolves.toBe(false)
    expect(toast).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
