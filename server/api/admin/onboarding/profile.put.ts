import { ADMIN_PROFILE_ONBOARDING_UPDATE_ACTION } from '#shared/config/admin-defaults'
import { adminInitialProfileSchema } from '~~/server/schemas/admin'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { userCredentialsService } from '~~/server/services/user-credentials-service'
import { createUserSession, defineAdminEventHandler } from '~~/server/utils/auth'
import { readZodBody } from '~~/server/utils/zod'

export default defineAdminEventHandler(async (event, admin) => {
  const body = await readZodBody(event, adminInitialProfileSchema)

  const { updated, detail } = await userCredentialsService.completeAdminProfile({
    ...body,
    userId: admin.id,
    expectedTokenVersion: admin.tokenVersion
  })

  // actor 用改名后的用户名。这条审计记录的对象就是这次改名本身，
  // 若沿用会话里的旧快照，后台会显示成「admin 改了自己的名字」，
  // 而此后所有记录都是新名字——这个断层没有追溯价值。旧名字进 detail 保留。
  await addRequestOperationLog(event, {
    userId: admin.id,
    actor: updated.username,
    action: ADMIN_PROFILE_ONBOARDING_UPDATE_ACTION,
    resourceType: 'user',
    resourceId: admin.id,
    detail
  })
  await createUserSession(event, { id: updated.id, role: updated.role }, { expectedTokenVersion: updated.tokenVersion })

  const { passwordHash: _passwordHash, tokenVersion: _tokenVersion, ...safe } = updated
  return safe
})
