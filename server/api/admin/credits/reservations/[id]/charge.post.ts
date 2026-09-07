import { creditService } from '~~/server/services/credit-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readPositiveIntegerRouterParam } from '~~/server/utils/router-param'

export default defineAdminEventHandler(async (event, admin) => {
  const id = readPositiveIntegerRouterParam(event)
  const result = await creditService.forceFinalizeCreditReservation(id, {
    id: admin.id,
    name: admin.username
  })
  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: admin.username,
    action: 'admin.credit-reservation.charge',
    resourceType: 'credit-reservation',
    resourceId: id,
    detail: result
  })
  return result
})
