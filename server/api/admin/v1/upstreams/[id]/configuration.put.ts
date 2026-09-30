import { adminUpdateServiceConfigurationSchema } from '~~/server/schemas/admin'
import { platformServiceControlService } from '~~/server/services/platform-service-control-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readUuidRouterParam } from '~~/server/utils/router-param'
import { readZodBody } from '~~/server/utils/zod'

export default defineAdminEventHandler(async (event, admin) => {
  const upstreamId = readUuidRouterParam(event)
  const body = await readZodBody(
    event,
    adminUpdateServiceConfigurationSchema
  )
  const result = await platformServiceControlService.updateConfiguration(
    upstreamId,
    body
  )
  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: admin.username,
    action: 'admin.platform.service.configuration.update',
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
