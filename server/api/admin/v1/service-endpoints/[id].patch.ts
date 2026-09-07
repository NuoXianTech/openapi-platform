import { adminUpdateEndpointPublicationSchema } from '~~/server/schemas/admin'
import { platformEndpointCatalogService } from '~~/server/services/platform-endpoint-catalog-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readUuidRouterParam } from '~~/server/utils/router-param'
import { readZodBody } from '~~/server/utils/zod'
import { toPlatformEndpointPublicationResult } from '~~/server/utils/platform-view'

export default defineAdminEventHandler(async (event, admin) => {
  const routeId = readUuidRouterParam(event)
  const body = await readZodBody(
    event,
    adminUpdateEndpointPublicationSchema
  )
  const result = await platformEndpointCatalogService.update(
    routeId,
    body,
    admin.id,
    { publishRouting: false }
  )
  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: admin.username,
    action: body.enabled === false
      ? 'admin.platform.endpoint.unpublish'
      : 'admin.platform.endpoint.update',
    resourceType: 'api-route',
    resourceId: result.route.id,
    detail: {
      enabled: body.enabled,
      isApiKey: body.isApiKey,
      isStatistics: body.isStatistics,
      revisionId: result.revision?.id ?? null,
      revisionSequence: result.revision?.sequence ?? null
    }
  })
  return toPlatformEndpointPublicationResult(result)
})
