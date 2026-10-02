import { adminGenerateRedemptionCodeSchema } from '~~/server/schemas/admin'
import { redemptionService } from '~~/server/services/redemption-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readZodBody } from '~~/server/utils/zod'

export default defineAdminEventHandler(async (event, admin) => {
  const body = await readZodBody(event, adminGenerateRedemptionCodeSchema)

  const data = await redemptionService.generate({
    ...body,
    createdBy: admin.id
  })

  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: admin.username,
    action: 'admin.redemption-code.generate',
    resourceType: 'redemption-code',
    resourceId: data.batchId,
    detail: {
      batchId: data.batchId,
      generated: data.generated,
      amount: data.amount,
      maxUses: data.maxUses,
      note: data.note
    }
  })

  return data
})
