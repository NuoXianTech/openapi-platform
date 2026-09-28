import { adminPublishServiceEndpointSchema } from '~~/server/schemas/admin'
import { platformEndpointService } from '~~/server/services/platform-endpoint-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readZodBody } from '~~/server/utils/zod'
import { toPlatformEndpointPublicationResult } from '~~/server/utils/platform-view'

export default defineAdminEventHandler(async (event, admin) => {
  const body = await readZodBody(event, adminPublishServiceEndpointSchema)
  const result = await platformEndpointService.publish(body, admin.id, {
    publishRouting: false
  })
  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: admin.username,
    action: 'admin.platform.endpoint.publish',
    resourceType: 'api-route',
    resourceId: result.route.id,
    detail: {
      upstreamServiceId: body.upstreamServiceId,
      method: body.method,
      servicePath: body.path,
      revisionId: result.revision?.id ?? null,
      revisionSequence: result.revision?.sequence ?? null,
      created: result.created
    }
  })
  return toPlatformEndpointPublicationResult(result)
})
