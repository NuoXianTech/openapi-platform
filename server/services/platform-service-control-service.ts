import type { ServiceControlRoutingOutcome, ServiceDiscoveryOutcome, ServiceConfigurationSyncOutcome } from '#shared/types/service-control'
import { refreshServiceControlAvailability, getServiceControlView } from '~~/server/services/platform-service-control-context'
import { refreshPlatformRevision } from '~~/server/services/routing-revision-service'
import { hasReadyServiceTarget } from '~~/server/utils/service-upstream-readiness'
import {
  synchronizePlatformServiceConfiguration,
  updatePlatformServiceConfiguration
} from '~~/server/services/platform-service-configuration-service'
import { discoverPlatformService } from '~~/server/services/platform-service-discovery-service'

const activeDiscoveries = new Map<string, Promise<ServiceDiscoveryOutcome>>()

// Network results have committed before this phase. Publication failure must
// not turn a saved contract/configuration into a failed mutation or skip audit.
async function completeRouting(upstreamId: string, publish: boolean): Promise<ServiceControlRoutingOutcome> {
  if (!publish) return { routingRevision: null, routingStatus: 'skipped' }
  try {
    const { revision } = await refreshPlatformRevision(null)
    return { routingRevision: revision, routingStatus: 'applied' }
  } catch (error) {
    console.error('[service-control] routing publication pending', {
      upstreamId,
      error: error instanceof Error ? error.message : 'publication failed'
    })
    return { routingRevision: null, routingStatus: 'pending' }
  }
}

async function discover(upstreamId: string): Promise<ServiceDiscoveryOutcome> {
  const { context, view } = await discoverPlatformService(upstreamId)
  const routing = await completeRouting(upstreamId, hasReadyServiceTarget(context.targets, context.connection))
  return { ...await refreshServiceControlAvailability(context, view), ...routing }
}

export const platformServiceControlService = {
  get: getServiceControlView,

  discover(upstreamId: string): Promise<ServiceDiscoveryOutcome> {
    const active = activeDiscoveries.get(upstreamId)
    if (active) return active
    const operation = discover(upstreamId).finally(() => { activeDiscoveries.delete(upstreamId) })
    activeDiscoveries.set(upstreamId, operation)
    return operation
  },

  async updateConfiguration(
    upstreamId: string,
    input: Parameters<typeof updatePlatformServiceConfiguration>[1]
  ): Promise<ServiceConfigurationSyncOutcome> {
    const result = await updatePlatformServiceConfiguration(upstreamId, input)
    return { ...result, ...await completeRouting(upstreamId, result.status !== 'failed') }
  },

  async synchronizeConfiguration(upstreamId: string): Promise<ServiceConfigurationSyncOutcome> {
    const result = await synchronizePlatformServiceConfiguration(upstreamId)
    return { ...result, ...await completeRouting(upstreamId, result.status !== 'failed') }
  }
}
