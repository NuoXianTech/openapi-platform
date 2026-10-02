import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { serviceConfigurationDefinitionSchema } from '#shared/service-control'
import type { ServiceConfigurationDefinition } from '#shared/types/service-control'
import {
  assertServiceConfigurationDefinition,
  calculateServiceConfigurationHash,
  normalizeServiceConfigurationValues,
  prepareServiceConfiguration,
  publicStoredServiceConfiguration,
  ServiceConfigurationValueError
} from '~~/server/utils/service-configuration-values'

const definition = {
  schemaVersion: 1,
  groups: [{
    key: 'music',
    label: 'Music',
    fields: [
      {
        key: 'music.enabled',
        type: 'boolean',
        label: 'Enabled',
        default: true
      },
      {
        key: 'music.requestTimeout',
        type: 'number',
        label: 'Timeout',
        default: 5,
        minimum: 1,
        maximum: 30,
        step: 1
      },
      {
        key: 'music.primaryPlatform',
        type: 'single-select',
        label: 'Primary platform',
        default: 'netease',
        options: [
          { label: 'NetEase', value: 'netease' },
          { label: 'QQ Music', value: 'qq' }
        ]
      },
      {
        key: 'music.enabledPlatforms',
        type: 'multi-select',
        label: 'Enabled platforms',
        default: ['netease'],
        options: [
          { label: 'NetEase', value: 'netease' },
          { label: 'QQ Music', value: 'qq' }
        ]
      },
      {
        key: 'music.neteaseCookie',
        type: 'secret',
        label: 'Cookie',
        maxLength: 4096
      }
    ]
  }]
} as const satisfies ServiceConfigurationDefinition

describe('service configuration values', () => {
  it('accepts camelCase field segments used by business modules', () => {
    expect(serviceConfigurationDefinitionSchema.safeParse(definition).success)
      .toBe(true)
    expect(() => assertServiceConfigurationDefinition(definition))
      .not.toThrow()
  })

  it('normalizes every supported value kind', () => {
    expect(normalizeServiceConfigurationValues(definition, {
      'music.enabled': false,
      'music.requestTimeout': 10,
      'music.primaryPlatform': 'qq',
      'music.enabledPlatforms': ['qq', 'qq', 'netease'],
      'music.neteaseCookie': 'secret-cookie'
    })).toEqual({
      'music.enabled': false,
      'music.requestTimeout': 10,
      'music.primaryPlatform': 'qq',
      'music.enabledPlatforms': ['qq', 'netease'],
      'music.neteaseCookie': 'secret-cookie'
    })
  })

  it('rejects unknown fields and invalid select options', () => {
    expect(() => normalizeServiceConfigurationValues(definition, {
      'music.unknown': true
    })).toThrow(ServiceConfigurationValueError)
    expect(() => normalizeServiceConfigurationValues(definition, {
      'music.primaryPlatform': 'unsupported'
    })).toThrow(ServiceConfigurationValueError)
  })

  it('rejects duplicate fields and option values before rendering a form', () => {
    const duplicateField = structuredClone(definition) as
      ServiceConfigurationDefinition
    duplicateField.groups[0]!.fields.push(
      structuredClone(duplicateField.groups[0]!.fields[0]!)
    )
    expect(() => assertServiceConfigurationDefinition(duplicateField))
      .toThrow(/duplicate service configuration field/)

    const duplicateOption = structuredClone(definition) as
      ServiceConfigurationDefinition
    const select = duplicateOption.groups[0]!.fields[2]!
    if (select.type !== 'single-select') throw new Error('invalid fixture')
    select.options.push({ label: 'Duplicate', value: 'netease' })
    expect(() => assertServiceConfigurationDefinition(duplicateOption))
      .toThrow(/duplicate option value/)
  })

  it('calculates a stable fingerprint independent of object key order', () => {
    const left = calculateServiceConfigurationHash('a'.repeat(64), {
      'music.enabled': true,
      'music.neteaseCookie': 'secret-cookie'
    })
    const right = calculateServiceConfigurationHash('a'.repeat(64), {
      'music.neteaseCookie': 'secret-cookie',
      'music.enabled': true
    })

    expect(left).toBe(right)
    expect(left).toMatch(/^[0-9a-f]{64}$/)
  })
})


describe('prepared service configuration', () => {
  beforeEach(() => {
    vi.stubGlobal('useRuntimeConfig', () => ({ apiKeySecret: '0123456789abcdef0123456789abcdef' }))
  })
  afterEach(() => vi.unstubAllGlobals())

  const input = {
    definition, schemaSha256: 'a'.repeat(64), stored: { values: {}, secrets: {} },
    valueUpdates: {}, secretUpdates: {}
  }

  it('round-trips normalized configuration and keeps public projections consistent without leaking secrets', () => {
    const prepared = prepareServiceConfiguration({ ...input,
      valueUpdates: { 'music.enabled': false, 'music.enabledPlatforms': ['qq', 'qq'] },
      secretUpdates: { 'music.neteaseCookie': 'private-cookie' }
    })
    const stored = prepared.toStoredValues()
    expect(JSON.stringify(stored)).not.toContain('private-cookie')
    expect(stored.secrets['music.neteaseCookie']).toMatch(/^enc:service-configuration:v1:/)
    const restored = prepareServiceConfiguration({ ...input, stored })
    expect(restored.values).toEqual(prepared.values)
    expect(restored.hash).toBe(prepared.hash)
    expect(restored.values).toMatchObject({
      'music.enabled': false, 'music.requestTimeout': 5, 'music.enabledPlatforms': ['qq'],
      'music.neteaseCookie': 'private-cookie'
    })
    expect(publicStoredServiceConfiguration(definition, stored)).toEqual(prepared.publicValues)
    expect(restored.publicValues).toEqual(prepared.publicValues)
    expect(JSON.stringify(prepared.publicValues)).not.toContain('private-cookie')
  })

  it('preserves omitted secrets and clears explicitly removed secrets', () => {
    const original = prepareServiceConfiguration({ ...input, secretUpdates: { 'music.neteaseCookie': 'keep-me' } })
    const stored = original.toStoredValues()
    const preserved = prepareServiceConfiguration({ ...input, stored, valueUpdates: { 'music.enabled': false } })
    expect(preserved.values['music.neteaseCookie']).toBe('keep-me')
    const cleared = prepareServiceConfiguration({ ...input, stored, secretUpdates: { 'music.neteaseCookie': null } })
    expect(cleared.values['music.neteaseCookie']).toBe('')
    expect(cleared.toStoredValues().secrets).toEqual({})
    expect(cleared.publicValues['music.neteaseCookie']).toEqual({ configured: false })
    expect(cleared.hash).not.toBe(original.hash)
  })

  it('reads only secret presence even when ciphertext cannot be decrypted', () => {
    const stored = { values: {}, secrets: { 'music.neteaseCookie': 'unreadable-ciphertext' } }
    expect(publicStoredServiceConfiguration(definition, stored)).toMatchObject({
      'music.neteaseCookie': { configured: true }, 'music.enabled': true
    })
    expect(publicStoredServiceConfiguration(null, stored)).toEqual({})
    expect(() => prepareServiceConfiguration({ ...input, stored })).toThrow()
  })

  it.each([
    { valueUpdates: { 'music.neteaseCookie': 'secret-in-values' }, secretUpdates: {} },
    { valueUpdates: { unknown: true }, secretUpdates: {} },
    { valueUpdates: {}, secretUpdates: { 'music.enabled': 'not-a-secret' } },
    { valueUpdates: { 'music.requestTimeout': 100 }, secretUpdates: {} }
  ])('rejects invalid updates before producing any representation: %j', (updates) => {
    expect(() => prepareServiceConfiguration({ ...input, ...updates })).toThrow(ServiceConfigurationValueError)
  })
})
