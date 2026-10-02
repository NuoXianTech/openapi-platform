import { createError } from 'h3'
import { adminUpdateOauthProviderSchema } from '~~/server/schemas/admin'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { oauthProviderService, toAdminOauthProviderSafe, type OauthProviderPatch } from '~~/server/services/oauth-provider-service'
import { addRequestOperationLog } from '~~/server/utils/request-operation-log'
import { isSupportedOauthProvider } from '~~/server/utils/oauth-provider-id'
import { readZodBody } from '~~/server/utils/zod'

export default defineAdminEventHandler(async (event, admin) => {
  const body = await readZodBody(event, adminUpdateOauthProviderSchema)
  const { provider } = body
  if (!isSupportedOauthProvider(provider)) {
    throw createError({ statusCode: 400, message: 'provider 不合法，仅支持 github / qq' })
  }

  const current = await oauthProviderService.getByProvider(provider)
  if (!current) {
    throw createError({ statusCode: 404, message: 'provider not found' })
  }

  const patch: OauthProviderPatch = {}
  if (body.clientId !== undefined) patch.clientId = body.clientId
  if (body.clientSecret !== undefined) patch.clientSecret = body.clientSecret
  if (body.isEnabled !== undefined) patch.isEnabled = body.isEnabled

  const updated = await oauthProviderService.update(provider, patch)

  const changedFields = [
    patch.clientId !== undefined && patch.clientId.trim() !== current.clientId ? 'clientId' : null,
    patch.clientSecret !== undefined && patch.clientSecret !== current.clientSecret ? 'clientSecret' : null,
    patch.isEnabled !== undefined && patch.isEnabled !== current.isEnabled ? 'isEnabled' : null
  ].filter((field): field is string => Boolean(field))

  if (changedFields.length > 0) {
    await addRequestOperationLog(event, {
      userId: admin.id,
      actor: admin.username,
      action: 'admin.oauth-provider.update',
      resourceType: 'oauth-provider',
      resourceId: updated.provider,
      detail: { provider: updated.provider, changedFields }
    })
  }

  return toAdminOauthProviderSafe(updated)
})
