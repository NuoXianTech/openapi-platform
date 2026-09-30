// 消费 reset_password token 并设置新密码。
import { resetPasswordSchema } from '~~/server/schemas/auth'
import { userCredentialsService } from '~~/server/services/user-credentials-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { readZodBody } from '~~/server/utils/zod'

export default defineEventHandler(async (event) => {
  const user = await userCredentialsService.resetPassword(await readZodBody(event, resetPasswordSchema))

  // 凭据变更 + 全会话失效必须留痕：走重置链接改密与走 user.password.change 改密
  // 在追溯上是同等事件，缺一条就意味着「拿到泄露的重置 token 改密」是无痕路径。
  // 操作者是匿名请求，因此只能记账号自身的身份快照。
  await addRequestOperationLog(event, {
    userId: user.id,
    actor: user.username,
    action: 'user.password.reset',
    resourceType: 'user',
    resourceId: user.id,
    detail: { sessionsInvalidated: true }
  })

  return null
})
