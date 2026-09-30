import type { PlatformUpstreamDetail } from '#shared/types/service-control'
import { buildServiceControlView, loadServiceControlContext } from './platform-service-control-context'
import { toPlatformUpstream } from '~~/server/utils/platform-view'

/** One context and one probe set for the currently selected Upstream. */
export async function getPlatformUpstreamDetail(id: string): Promise<PlatformUpstreamDetail> {
  const context = await loadServiceControlContext(id)
  const view = await buildServiceControlView(context, { checkAvailability: true })
  return {
    ...view,
    upstream: toPlatformUpstream({ ...context.service, targets: context.targets, connection: view.connection })
  }
}
