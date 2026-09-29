import { gatewayCallService } from '~~/server/services/dynamic-gateway-call-service'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('afterResponse', event => gatewayCallService.complete(event))
})
