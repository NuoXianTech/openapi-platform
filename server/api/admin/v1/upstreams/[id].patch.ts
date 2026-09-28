import { adminUpdateUpstreamSchema } from '~~/server/schemas/admin'
import { platformUpstreamService } from '~~/server/services/platform-upstream-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { readUuidRouterParam } from '~~/server/utils/router-param'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readZodBody } from '~~/server/utils/zod'
import { toPlatformUpstreamSummary } from '~~/server/utils/platform-view'

export default defineAdminEventHandler(async (event, admin) => {
  const id = readUuidRouterParam(event)
  const body = await readZodBody(event, adminUpdateUpstreamSchema)
  const result = await platformUpstreamService.updateAndPublish(id, body, admin.id)
  const updated = result.upstream
  const { serviceToken, ...patch } = body
  if (Object.keys(patch).length > 0) {
    await addRequestOperationLog(event, {
      userId: admin.id,
      actor: admin.username,
      action: 'admin.platform.upstream.update',
      resourceType: 'upstream-service',
      resourceId: id,
      detail: { patch }
    })
  }
  if (serviceToken !== undefined) {
    await addRequestOperationLog(event, {
      userId: admin.id,
      actor: admin.username,
      action: 'admin.platform.service.token.update',
      resourceType: 'upstream-service',
      resourceId: id,
      detail: { updated: true }
    })
  }
  return {
    ...toPlatformUpstreamSummary(updated),
    revision: result.revision
  }
})
