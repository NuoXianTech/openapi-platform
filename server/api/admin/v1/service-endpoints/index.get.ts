import { platformEndpointService } from '~~/server/services/platform-endpoint-service'
import { defineAdminEventHandler } from '~~/server/utils/auth'
import { toPlatformEndpointCatalog } from '~~/server/utils/platform-view'

export default defineAdminEventHandler(async () => (
  toPlatformEndpointCatalog(await platformEndpointService.list())
))
