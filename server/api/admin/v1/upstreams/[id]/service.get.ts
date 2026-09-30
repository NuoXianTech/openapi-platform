import { getPlatformUpstreamDetail } from '~~/server/services/platform-upstream-detail'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { readUuidRouterParam } from '~~/server/utils/router-param'

export default defineAdminEventHandler((event) => {
  const upstreamId = readUuidRouterParam(event)
  return getPlatformUpstreamDetail(upstreamId)
})
