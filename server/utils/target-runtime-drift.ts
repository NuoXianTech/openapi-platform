import type { RoutingRevisionUpstream } from '~~/server/types/routing-revision'
import type { TargetRuntimeDrift } from '~~/server/types/platform-publication'
import { isServiceTargetReady } from '~~/server/utils/service-upstream-readiness'

interface DriftTargetState {
  id: string
  baseUrl: string
  enabled: boolean
  configurationRevision: number | null
  configurationHash: string | null
  configurationStatus: string
  configurationState: unknown | null
}

interface DriftConnectionState {
  configurationRevision: number
  configurationHash: string | null
}

/**
 * Compares the stored Targets of one Upstream against the Targets the active
 * Routing Revision actually serves.
 */
export function findTargetRuntimeDrift(input: {
  targets: readonly DriftTargetState[]
  connection: DriftConnectionState | null
  runtimeUpstream: RoutingRevisionUpstream | null
}): TargetRuntimeDrift[] {
  if (!input.runtimeUpstream) return []

  const runtimeTargets = new Map(
    input.runtimeUpstream.targets.map(target => [target.id, target])
  )
  const drift: TargetRuntimeDrift[] = []

  for (const target of input.targets) {
    const runtimeTarget = runtimeTargets.get(target.id)
    const ready = isServiceTargetReady(target, input.connection)

    if (runtimeTarget && runtimeTarget.baseUrl !== target.baseUrl) {
      drift.push({
        targetId: target.id,
        kind: 'address_changed',
        runtimeBaseUrl: runtimeTarget.baseUrl,
        desiredBaseUrl: target.baseUrl
      })
      continue
    }
    if (!runtimeTarget && target.enabled && ready) {
      drift.push({
        targetId: target.id,
        kind: 'unpublished',
        runtimeBaseUrl: null,
        desiredBaseUrl: target.baseUrl
      })
    }
  }

  const storedIds = new Set(input.targets.map(target => target.id))
  for (const runtimeTarget of input.runtimeUpstream.targets) {
    if (storedIds.has(runtimeTarget.id)) continue
    drift.push({
      targetId: runtimeTarget.id,
      kind: 'withdrawn',
      runtimeBaseUrl: runtimeTarget.baseUrl,
      desiredBaseUrl: null
    })
  }

  return drift.sort((left, right) => left.targetId.localeCompare(right.targetId))
}
