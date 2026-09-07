import { describe, expect, it } from 'vitest'
import { findTargetRuntimeDrift } from '~~/server/utils/target-runtime-drift'

const connection = {
  configurationRevision: 3,
  configurationHash: 'a'.repeat(64)
}

function readyTarget(overrides: Partial<{
  id: string
  baseUrl: string
  enabled: boolean
}> = {}) {
  return {
    id: 'target-1',
    baseUrl: 'https://one.example.com/',
    enabled: true,
    configurationRevision: 3,
    configurationHash: 'a'.repeat(64),
    configurationStatus: 'synced',
    configurationState: { revision: 3 },
    ...overrides
  }
}

function runtimeUpstream(targets: Array<{ id: string, baseUrl: string }>) {
  return {
    id: 'upstream-1',
    loadBalancing: 'round_robin' as const,
    targets: targets.map(target => ({ ...target, weight: 1 }))
  }
}

describe('findTargetRuntimeDrift', () => {
  it('reports the runtime address when a Service Target address changed', () => {
    const drift = findTargetRuntimeDrift({
      // The address was repointed, so discovery reset the verification state.
      targets: [readyTarget({
        baseUrl: 'https://new.example.com/'
      })],
      connection,
      runtimeUpstream: runtimeUpstream([
        { id: 'target-1', baseUrl: 'https://old.example.com/' }
      ])
    })

    expect(drift).toEqual([{
      targetId: 'target-1',
      kind: 'address_changed',
      runtimeBaseUrl: 'https://old.example.com/',
      desiredBaseUrl: 'https://new.example.com/'
    }])
  })

  it('reports a verified Target that has not reached the runtime', () => {
    const drift = findTargetRuntimeDrift({
      targets: [
        readyTarget(),
        readyTarget({ id: 'target-2', baseUrl: 'https://two.example.com/' })
      ],
      connection,
      runtimeUpstream: runtimeUpstream([
        { id: 'target-1', baseUrl: 'https://one.example.com/' }
      ])
    })

    expect(drift).toEqual([{
      targetId: 'target-2',
      kind: 'unpublished',
      runtimeBaseUrl: null,
      desiredBaseUrl: 'https://two.example.com/'
    }])
  })

  it('reports a runtime Target that no longer exists', () => {
    const drift = findTargetRuntimeDrift({
      targets: [readyTarget()],
      connection,
      runtimeUpstream: runtimeUpstream([
        { id: 'target-1', baseUrl: 'https://one.example.com/' },
        { id: 'target-2', baseUrl: 'https://removed.example.com/' }
      ])
    })

    expect(drift).toEqual([{
      targetId: 'target-2',
      kind: 'withdrawn',
      runtimeBaseUrl: 'https://removed.example.com/',
      desiredBaseUrl: null
    }])
  })

  it('stays silent when the runtime matches the stored Targets', () => {
    expect(findTargetRuntimeDrift({
      targets: [readyTarget()],
      connection,
      runtimeUpstream: runtimeUpstream([
        { id: 'target-1', baseUrl: 'https://one.example.com/' }
      ])
    })).toEqual([])
  })

  it('does not report an unverified Target as unpublished', () => {
    // An unverified Target is intentionally withheld from the runtime, so its
    // absence is expected rather than drift.
    expect(findTargetRuntimeDrift({
      targets: [
        readyTarget(),
        {
          id: 'target-2',
          baseUrl: 'https://two.example.com/',
          enabled: true,
          configurationRevision: null,
          configurationHash: null,
          configurationStatus: 'unknown',
          configurationState: null
        }
      ],
      connection,
      runtimeUpstream: runtimeUpstream([
        { id: 'target-1', baseUrl: 'https://one.example.com/' }
      ])
    })).toEqual([])
  })

  it('ignores an Upstream that is not in the runtime at all', () => {
    expect(findTargetRuntimeDrift({
      targets: [readyTarget()],
      connection,
      runtimeUpstream: null
    })).toEqual([])
  })
})
