// 消费 change_email token，更新用户 email。POST 携带 userId / token，避免邮件预扫描或浏览器预取误触发副作用。
import { confirmEmailChangeSchema } from '~~/server/schemas/auth'
import { userCredentialsService } from '~~/server/services/user-credentials-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { readZodBody } from '~~/server/utils/zod'
import { toUserProfile } from '~~/server/utils/user-view'

export default defineEventHandler(async (event) => {
  const { userId, token } = await readZodBody(event, confirmEmailChangeSchema)

  const updated = await userCredentialsService.confirmEmailChange(userId, token)

  await addRequestOperationLog(event, {
    userId: updated.id,
    actor: updated.username,
    action: 'user.email.change.confirm',
    resourceType: 'user',
    resourceId: updated.id,
    detail: { emailChanged: true }
  })

  return toUserProfile(updated)
})
