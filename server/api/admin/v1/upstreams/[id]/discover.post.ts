import { platformServiceControlService } from '~~/server/services/platform-service-control-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readUuidRouterParam } from '~~/server/utils/router-param'

export default defineAdminEventHandler(async (event, admin) => {
  const upstreamId = readUuidRouterParam(event)
  const result = await platformServiceControlService.discover(upstreamId)
  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: admin.username,
    action: 'admin.platform.service.discover',
    resourceType: 'upstream-service',
    resourceId: upstreamId,
    detail: {
      serviceId: result.connection.serviceId,
      serviceProtocol: result.connection.serviceProtocol,
      openapiSha256: result.connection.openapiSha256,
      routingStatus: result.routingStatus,
      routingRevision: result.routingRevision,
      endpointCount: result.endpoints.filter(endpoint => (
        !endpoint.system && !endpoint.support
      )).length
    }
  })
  return result
})
