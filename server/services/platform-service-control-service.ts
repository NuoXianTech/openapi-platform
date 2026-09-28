import { getServiceControlView } from '~~/server/services/platform-service-control-context'
import {
  synchronizePlatformServiceConfiguration,
  updatePlatformServiceConfiguration
} from '~~/server/services/platform-service-configuration-service'
import { discoverPlatformService } from '~~/server/services/platform-service-discovery-service'

export const platformServiceControlService = {
  get: getServiceControlView,

  discover: discoverPlatformService,

  updateConfiguration: updatePlatformServiceConfiguration,

  synchronizeConfiguration: synchronizePlatformServiceConfiguration
}
