import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGatewayTargetHealth } from '~~/server/services/gateway-target-health'
import { createMemoryTargetHealthStore, type TargetHealthSnapshot } from '~~/server/services/gateway-target-health-store'

const a = { id: 'a', baseUrl: 'http://old-target' }
const b = { id: 'b', baseUrl: 'http://other-target' }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T00:00:00Z')) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Target health lifecycle', () => {
  it('rejects a pre-reset probe even after the same Target becomes active again', () => {
    const health = createGatewayTargetHealth(createMemoryTargetHealthStore())
    const old = health.begin('u', a)
    health.reset('u', a.id)
    health.report(health.begin('u', a), false)
    health.report(health.begin('u', a), false)
    health.report(old, true)
    expect(health.available('u', [a, b])).toEqual([b])
  })

  it('rejects older success and failure results after newer observations', () => {
    const health = createGatewayTargetHealth(createMemoryTargetHealthStore())
    const oldSuccess = health.begin('u', a)
    health.report(health.begin('u', a), false)
    health.report(health.begin('u', a), false)
    health.report(oldSuccess, true)
    expect(health.available('u', [a])).toEqual([])
    const oldFailure = health.begin('u', a)
    health.report(health.begin('u', a), true)
    health.report(oldFailure, false)
    health.report(health.begin('u', a), false)
    expect(health.available('u', [a])).toEqual([a])
  })

  it('isolates observations of a replaced address while retaining the Target ID', () => {
    const health = createGatewayTargetHealth(createMemoryTargetHealthStore())
    const replacement = { ...a, baseUrl: 'http://replacement' }
    health.report(health.begin('u', a), false)
    health.report(health.begin('u', a), false)
    expect(health.available('u', [replacement])).toEqual([replacement])
  })

  it.each(['reset', 'success'] as const)('does not revive old failures from an in-flight read after %s', async (action) => {
    const backing = createMemoryTargetHealthStore()
    let release!: (snapshot: TargetHealthSnapshot) => void
    const health = createGatewayTargetHealth({ ...backing, read: () => new Promise(resolve => { release = resolve }) })
    const old = { observedAt: Date.now() * 1_000 - 1, failures: 3, ejectedUntil: Date.now() + 30_000 }
    const pending = health.hydrate('u', [a])
    if (action === 'reset') health.reset('u', a.id)
    else health.report(health.begin('u', a), true)
    release({ resetAt: 0, state: old })
    await pending
    expect(health.available('u', [a])).toEqual([a])
  })

  it('shared reset fences reject a late write from another instance', async () => {
    const backing = createMemoryTargetHealthStore()
    const first = createGatewayTargetHealth(backing)
    const second = createGatewayTargetHealth(backing)
    const old = first.begin('u', a)
    vi.advanceTimersByTime(10)
    second.reset('u', a.id)
    first.report(old, false)
    await flush()
    first.report(first.begin('u', a), false)
    await flush()
    // The rejected old failure must not contribute the second strike.
    expect(first.available('u', [a])).toEqual([a])
  })

  it('shares recovery tombstones instead of resurrecting deleted failures', async () => {
    const backing = createMemoryTargetHealthStore()
    const first = createGatewayTargetHealth(backing)
    const second = createGatewayTargetHealth(backing)
    first.report(first.begin('u', a), false)
    first.report(first.begin('u', a), false)
    await flush()
    await second.hydrate('u', [a])
    expect(second.available('u', [a])).toEqual([])
    first.report(first.begin('u', a), true)
    await flush()
    vi.advanceTimersByTime(5_001)
    await second.hydrate('u', [a])
    expect(second.available('u', [a])).toEqual([a])
  })

  it('does not advance shared observation time by milliseconds for every request', async () => {
    const backing = createMemoryTargetHealthStore()
    const busy = createGatewayTargetHealth(backing)
    const other = createGatewayTargetHealth(backing)
    for (let i = 0; i < 2_000; i++) busy.begin('u', b)
    const old = busy.begin('u', a)
    vi.advanceTimersByTime(10)
    other.reset('u', a.id)
    busy.report(old, false)
    await flush()
    busy.report(busy.begin('u', a), false)
    await flush()
    expect(busy.available('u', [a])).toEqual([a])
  })

  it('limits shared reads to 100ms without losing later results', async () => {
    const backing = createMemoryTargetHealthStore()
    let release!: (snapshot: TargetHealthSnapshot) => void
    const health = createGatewayTargetHealth({ ...backing, read: () => new Promise(resolve => { release = resolve }) })
    const pending = health.hydrate('u', [a])
    await vi.advanceTimersByTimeAsync(100)
    await pending
    expect(health.available('u', [a])).toEqual([a])
    release({ resetAt: 0, state: { observedAt: Date.now() * 1_000, failures: 2, ejectedUntil: Date.now() + 15_000 } })
    await flush()
    expect(health.available('u', [a])).toEqual([])
  })

  it('keeps local behavior when the shared store fails', async () => {
    const backing = createMemoryTargetHealthStore()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const health = createGatewayTargetHealth({ ...backing, read: vi.fn().mockRejectedValue(new Error('offline')), write: vi.fn().mockRejectedValue(new Error('offline')) })
    await health.hydrate('u', [a])
    health.report(health.begin('u', a), false)
    health.report(health.begin('u', a), false)
    await flush()
    expect(health.available('u', [a])).toEqual([])
  })
})
