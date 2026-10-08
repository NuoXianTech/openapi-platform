import { createHash } from 'node:crypto'
import type {
  ServiceConfigurationDefinition,
  ServiceConfigurationField,
  ServiceConfigurationValue,
  ServiceConfigurationSyncResult,
  StoredServiceConfigurationValues
} from '#shared/types/service-control'
import { decryptStoredSecret, encryptStoredSecret } from '~~/server/utils/stored-secret'
import { canonicalJson } from '~~/server/utils/canonical-json'
import { parseServiceConfigurationField } from '#shared/utils/service-configuration-field'

export class ServiceConfigurationValueError extends Error {
  constructor(
    readonly field: string,
    message: string
  ) {
    super(message)
    this.name = 'ServiceConfigurationValueError'
  }
}

export function serviceConfigurationFields(
  definition: ServiceConfigurationDefinition
): ServiceConfigurationField[] {
  return definition.groups.flatMap(group => group.fields)
}

export function assertServiceConfigurationDefinition(
  definition: ServiceConfigurationDefinition
): void {
  const groupKeys = new Set<string>()
  const fieldKeys = new Set<string>()

  for (const group of definition.groups) {
    if (groupKeys.has(group.key)) {
      throw new ServiceConfigurationValueError(
        group.key,
        `duplicate service configuration group: ${group.key}`
      )
    }
    groupKeys.add(group.key)

    for (const field of group.fields) {
      if (fieldKeys.has(field.key)) {
        throw new ServiceConfigurationValueError(
          field.key,
          `duplicate service configuration field: ${field.key}`
        )
      }
      fieldKeys.add(field.key)

      if (
        (field.type === 'text'
          || field.type === 'textarea'
          || field.type === 'secret')
        && field.minLength !== undefined
        && field.maxLength !== undefined
        && field.minLength > field.maxLength
      ) {
        throw new ServiceConfigurationValueError(
          field.key,
          `${field.key} has minLength greater than maxLength`
        )
      }
      if (
        field.type === 'number'
        && field.minimum !== undefined
        && field.maximum !== undefined
        && field.minimum > field.maximum
      ) {
        throw new ServiceConfigurationValueError(
          field.key,
          `${field.key} has minimum greater than maximum`
        )
      }
      if (field.type === 'single-select' || field.type === 'multi-select') {
        const optionValues = new Set<string>()
        for (const option of field.options) {
          if (optionValues.has(option.value)) {
            throw new ServiceConfigurationValueError(
              field.key,
              `${field.key} contains duplicate option value: ${option.value}`
            )
          }
          optionValues.add(option.value)
        }
      }
    }
  }
}

export function defaultServiceConfigurationValues(
  definition: ServiceConfigurationDefinition
): Record<string, ServiceConfigurationValue> {
  return Object.fromEntries(
    serviceConfigurationFields(definition).map(field => [
      field.key,
      field.type === 'secret' ? '' : structuredClone(field.default)
    ])
  )
}

export function normalizeServiceConfigurationValues(
  definition: ServiceConfigurationDefinition,
  input: Record<string, unknown>,
  baseValues: Record<string, ServiceConfigurationValue> =
    defaultServiceConfigurationValues(definition)
): Record<string, ServiceConfigurationValue> {
  const fields = serviceConfigurationFields(definition)
  const knownKeys = new Set(fields.map(field => field.key))
  const unknownKey = Object.keys(input).find(key => !knownKeys.has(key))
  if (unknownKey) {
    throw new ServiceConfigurationValueError(
      unknownKey,
      `unknown service configuration field: ${unknownKey}`
    )
  }

  const normalized: Record<string, ServiceConfigurationValue> = {}
  for (const field of fields) {
    const value = Object.hasOwn(input, field.key)
      ? input[field.key]
      : baseValues[field.key]
    const result = parseServiceConfigurationField(field, value)
    if (!result.valid) throw new ServiceConfigurationValueError(field.key, result.message)
    normalized[field.key] = result.value
  }
  return normalized
}

export function calculateServiceConfigurationHash(
  schemaSha256: string,
  values: Record<string, ServiceConfigurationValue>
): string {
  return createHash('sha256')
    .update(canonicalJson({ schemaSha256, values }))
    .digest('hex')
}

export interface PreparedServiceConfiguration {
  values: Record<string, ServiceConfigurationValue>
  hash: string
  publicValues: ServiceConfigurationSyncResult['values']
  toStoredValues: () => StoredServiceConfigurationValues
}

/** Resolve updates once, then keep delivery, hashing and public projection on
 * the same normalized values. Synchronization does not re-encrypt storage. */
export function prepareServiceConfiguration(input: {
  definition: ServiceConfigurationDefinition
  schemaSha256: string
  stored: StoredServiceConfigurationValues
  valueUpdates: Record<string, unknown>
  secretUpdates: Record<string, string | null>
}): PreparedServiceConfiguration {
  const values = reconstructConfiguration(input)
  return {
    values,
    hash: calculateServiceConfigurationHash(input.schemaSha256, values),
    publicValues: projectConfiguration(input.definition, values, key => Boolean(values[key])),
    toStoredValues: () => storeConfigurationValues(input.definition, values)
  }
}

/** The management read path only observes secret presence, never plaintext. */
export function publicStoredServiceConfiguration(
  definition: ServiceConfigurationDefinition | null,
  stored: StoredServiceConfigurationValues
): ServiceConfigurationSyncResult['values'] {
  return definition
    ? projectConfiguration(definition, stored.values, key => Boolean(stored.secrets[key]))
    : {}
}

function projectConfiguration(
  definition: ServiceConfigurationDefinition,
  values: Record<string, ServiceConfigurationValue>,
  secretConfigured: (key: string) => boolean
): ServiceConfigurationSyncResult['values'] {
  const defaults = defaultServiceConfigurationValues(definition)
  return Object.fromEntries(serviceConfigurationFields(definition).map(field => [
    field.key,
    field.type === 'secret'
      ? { configured: secretConfigured(field.key) }
      : values[field.key] ?? defaults[field.key]!
  ]))
}

function reconstructConfiguration(input: {
  definition: ServiceConfigurationDefinition
  stored: StoredServiceConfigurationValues
  valueUpdates: Record<string, unknown>
  secretUpdates: Record<string, string | null>
}) {
  const fields = serviceConfigurationFields(input.definition)
  const fieldMap = new Map(fields.map(field => [field.key, field]))
  const unknownValue = Object.keys(input.valueUpdates)
    .find(key => fieldMap.get(key)?.type === 'secret' || !fieldMap.has(key))
  if (unknownValue) {
    throw new ServiceConfigurationValueError(
      unknownValue,
      `invalid non-secret configuration field: ${unknownValue}`
    )
  }
  const unknownSecret = Object.keys(input.secretUpdates)
    .find(key => fieldMap.get(key)?.type !== 'secret')
  if (unknownSecret) {
    throw new ServiceConfigurationValueError(
      unknownSecret,
      `invalid secret configuration field: ${unknownSecret}`
    )
  }

  const defaults = defaultServiceConfigurationValues(input.definition)
  const candidate: Record<string, unknown> = {}
  for (const field of fields) {
    if (field.type === 'secret') {
      if (Object.hasOwn(input.secretUpdates, field.key)) {
        candidate[field.key] = input.secretUpdates[field.key] ?? ''
      } else {
        const ciphertext = input.stored.secrets[field.key]
        candidate[field.key] = ciphertext
          ? decryptStoredSecret(ciphertext, 'service-configuration')
          : ''
      }
      continue
    }
    candidate[field.key] = Object.hasOwn(input.valueUpdates, field.key)
      ? input.valueUpdates[field.key]
      : input.stored.values[field.key] ?? defaults[field.key]
  }
  return normalizeServiceConfigurationValues(
    input.definition,
    candidate,
    defaults
  )
}

function storeConfigurationValues(
  definition: ServiceConfigurationDefinition,
  values: Record<string, ServiceConfigurationValue>
): StoredServiceConfigurationValues {
  const stored: StoredServiceConfigurationValues = {
    values: {},
    secrets: {}
  }
  for (const field of serviceConfigurationFields(definition)) {
    const value = values[field.key]
    if (field.type === 'secret') {
      if (typeof value === 'string' && value.length > 0) {
        stored.secrets[field.key] = encryptStoredSecret(
          value,
          'service-configuration'
        )
      }
    } else if (value !== undefined) {
      stored.values[field.key] = value
    }
  }
  return stored
}
