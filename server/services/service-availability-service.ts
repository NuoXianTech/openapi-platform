import { createHash } from 'node:crypto'
import type {
  ServiceAvailability,
  ServiceDescription,
  ServiceTargetAvailability
} from '#shared/types/service-control'
import { serviceControlClient } from '~~/server/utils/service-control-client'

// Bound queued work from one read; the client owns the process-wide HTTP budget.
const AVAILABILITY_TARGET_WORKERS = 16

interface AvailabilityTarget {
  id: string
  baseUrl: string
  enabled: boolean
}

interface ServiceAvailabilitySnapshot {
  overall: ServiceAvailability
  targets: Map<string, ServiceTargetAvailability>
}

const pendingAvailabilityRequests = new Map<string, Promise<boolean>>()

function targetAvailability(
  baseUrl: string,
  readinessPath: string,
  controlPath: string,
  serviceToken: string
): Promise<boolean> {
  const tokenHash = createHash('sha256').update(serviceToken).digest('hex')
  const key = `${baseUrl}\n${readinessPath}\n${controlPath}\n${tokenHash}`
  const pending = pendingAvailabilityRequests.get(key)
  if (pending) return pending

  const result = serviceControlClient.checkAvailability(
    baseUrl,
    readinessPath,
    controlPath,
    serviceToken
  )
  pendingAvailabilityRequests.set(key, result)
  const clearPending = () => {
    if (pendingAvailabilityRequests.get(key) === result) {
      pendingAvailabilityRequests.delete(key)
    }
  }
  void result.then(clearPending, clearPending)
  return result
}

export async function resolveServiceAvailability(
  description: ServiceDescription | null,
  targets: readonly AvailabilityTarget[],
  serviceToken: string | null
): Promise<ServiceAvailabilitySnapshot> {
  const targetStatuses = new Map<string, ServiceTargetAvailability>(
    targets.map(target => [target.id, 'unknown'])
  )
  const enabledTargets = targets.filter(target => target.enabled)
  if (!description || !serviceToken || enabledTargets.length === 0) {
    return { overall: 'unknown', targets: targetStatuses }
  }

  const availability: Array<{ id: string, online: boolean }> = []
  let nextTargetIndex = 0
  const probeWorker = async () => {
    while (true) {
      const index = nextTargetIndex++
      if (index >= enabledTargets.length) return
      const target = enabledTargets[index]!
      availability[index] = {
        id: target.id,
        online: await targetAvailability(
          target.baseUrl,
          description.readiness,
          description.configuration.state,
          serviceToken
        )
      }
    }
  }
  await Promise.all(Array.from({
    length: Math.min(AVAILABILITY_TARGET_WORKERS, enabledTargets.length)
  }, probeWorker))
  for (const target of availability) {
    targetStatuses.set(target.id, target.online ? 'online' : 'offline')
  }
  const readyTargets = availability.filter(target => target.online).length
  const overall = readyTargets === enabledTargets.length
    ? 'online'
    : readyTargets > 0 ? 'degraded' : 'offline'
  return { overall, targets: targetStatuses }
}
