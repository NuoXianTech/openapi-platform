import { createHash } from 'node:crypto'
import { createApplicationError } from '~~/server/errors/application-error'
import { serviceControlClient } from '~~/server/utils/service-control-client'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { assertServiceConfigurationDefinition } from '~~/server/utils/service-configuration-values'

/** Read and verify one Target before discovery may select its contract.
 * OpenAPI is intentionally fetched only after the compatible cohort is chosen. */
export async function readServiceTargetContract(baseUrl: string, token: string) {
  const description = await serviceControlClient.getDescription(
    baseUrl,
    token
  )
  const [definition, state] = await Promise.all([
    serviceControlClient.getConfigurationDefinition(
      baseUrl,
      description.data.configuration.schema,
      token
    ),
    serviceControlClient.getConfigurationState(
      baseUrl,
      description.data.configuration.state,
      token
    )
  ])
  const schemaSha256 = createHash('sha256')
    .update(canonicalJson(definition.data))
    .digest('hex')
  assertServiceConfigurationDefinition(definition.data)
  if (
    description.headers.get('x-openapi-sha256')
    !== description.data.openapiSha256
  ) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service description fingerprint mismatch',
      data: { code: 'SERVICE_OPENAPI_HASH_MISMATCH' }
    })
  }
  if (
    schemaSha256 !== description.data.configuration.schemaSha256
    || definition.headers.get('x-configuration-schema-sha256')
    !== schemaSha256
    || state.data.serviceId !== description.data.serviceId
    || state.data.schemaSha256 !== schemaSha256
  ) {
    throw createApplicationError({
      statusCode: 409,
      message: 'Service configuration fingerprint mismatch',
      data: { code: 'SERVICE_CONFIGURATION_HASH_MISMATCH' }
    })
  }
  return {
    description: description.data,
    definition: definition.data,
    state: state.data
  }
}
