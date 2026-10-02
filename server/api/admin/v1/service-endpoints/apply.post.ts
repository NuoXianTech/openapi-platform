import { applyPlatformRevision } from '~~/server/services/routing-revision-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { defineAdminEventHandler } from '~~/server/utils/auth'

export default defineAdminEventHandler(async (event, admin) => {
  const { revision } = await applyPlatformRevision(admin.id)
  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: admin.username,
    action: 'admin.platform.endpoint.apply',
    resourceType: 'routing-revision',
    resourceId: revision.id,
    detail: { revisionSequence: revision.sequence }
  })
  return { revision }
})
