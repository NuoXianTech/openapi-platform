import { afterEach, describe, expect, it, vi } from 'vitest'
import { useToast } from '@/composables/use-toast'

const native = vi.hoisted(() => ({
  toasts: { value: [] },
  add: vi.fn(options => ({ ...options, id: 'native-id' })),
  update: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn()
}))

vi.mock('@nuxt/ui/composables/useToast', () => ({ useToast: () => native }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function setup() {
  vi.stubGlobal('useAppConfig', () => ({
    ui: { icons: { success: 'success-icon', error: 'error-icon', warning: 'warning-icon', info: 'info-icon' } }
  }))
  return useToast()
}

describe('application toast defaults', () => {
  it('gives errors longer reading time than successful feedback and supplies missing icons', () => {
    const toast = setup()
    expect(toast.add({ title: 'Saved', color: 'success', icon: undefined })).toMatchObject({ icon: 'success-icon', duration: 3000 })
    expect(toast.add({ title: 'Failed', color: 'error' })).toMatchObject({ icon: 'error-icon', duration: 7000 })
    expect(toast.add({ title: 'Check input', color: 'warning' })).toMatchObject({ icon: 'warning-icon', duration: 5000 })
    expect(toast.add({ title: 'No results' })).toMatchObject({ icon: 'info-icon', color: 'neutral' })
  })

  it('preserves explicit icons, persistent duration, callbacks and the native lifecycle API', () => {
    const toast = setup()
    const onClick = vi.fn()
    const options = { title: 'Review changes', icon: 'custom-icon', duration: 0, onClick }
    expect(toast.add(options)).toEqual({ ...options, color: 'neutral', id: 'native-id' })
    expect(toast.toasts).toBe(native.toasts)
    expect(toast.update).toBe(native.update)
    expect(toast.remove).toBe(native.remove)
    expect(toast.clear).toBe(native.clear)
  })

  it('keeps actions available unless the caller supplies an expiry', () => {
    const toast = setup()
    const actions = [{ label: 'Retry', onClick: vi.fn() }]
    expect(toast.add({ title: 'Failed', color: 'error', actions })).toMatchObject({ duration: 0, actions })
    expect(toast.add({ title: 'Failed', actions, duration: 10000 })).toMatchObject({ duration: 10000, actions })
  })
})
