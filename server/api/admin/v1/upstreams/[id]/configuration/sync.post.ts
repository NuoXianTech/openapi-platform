import { platformServiceControlService } from '~~/server/services/platform-service-control-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readUuidRouterParam } from '~~/server/utils/router-param'

export default defineAdminEventHandler(async (event, admin) => {
  const upstreamId = readUuidRouterParam(event)
  const result = await platformServiceControlService
    .synchronizeConfiguration(upstreamId)
  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: admin.username,
    action: 'admin.platform.service.configuration.sync',
    resourceType: 'upstream-service',
    resourceId: upstreamId,
    detail: {
      revision: result.revision,
      status: result.status,
      routingStatus: result.routingStatus,
      targetCount: result.targets.length
    }
  })
  return result
})
