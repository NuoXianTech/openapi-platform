// 已登录用户修改密码：校验旧密码 → 设新密码 → 令所有旧 token 失效并重签当前设备
import { userChangePasswordSchema } from '~~/server/schemas/user'
import { userCredentialsService } from '~~/server/services/user-credentials-service'
import { defineAuthenticatedEventHandler, createUserSession } from '~~/server/utils/auth'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { readZodBody } from '~~/server/utils/zod'

export default defineAuthenticatedEventHandler(async (event, authUser) => {
  const { currentPassword, newPassword } = await readZodBody(event, userChangePasswordSchema)

  const updated = await userCredentialsService.changePassword(authUser.id, currentPassword, newPassword)

  // The credential change is already committed, even if a newer change
  // prevents this request from issuing its replacement session.
  await addRequestOperationLog(event, {
    userId: authUser.id,
    actor: authUser.username,
    action: 'user.password.change',
    resourceType: 'user',
    resourceId: authUser.id
  })

  await createUserSession(event, { id: authUser.id, role: authUser.role }, { expectedTokenVersion: updated.tokenVersion })

  return null
})
