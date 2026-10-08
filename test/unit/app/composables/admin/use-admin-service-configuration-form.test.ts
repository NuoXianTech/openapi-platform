import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceConfigurationField, ServiceConfigurationValue, ServiceConfigurationView } from '#shared/types/service-control'
import { useAdminServiceConfigurationForm } from '@/composables/admin/use-admin-service-configuration-form'
import { prepareServiceConfiguration, publicStoredServiceConfiguration, ServiceConfigurationValueError } from '~~/server/utils/service-configuration-values'

let scope = effectScope()

function createView(): ServiceConfigurationView {
  return {
    connection: {
      upstreamServiceId: 'upstream-1',
      discovered: true,
      availability: 'online',
      tokenConfigured: true,
      serviceId: 'test-service',
      serviceName: 'Test Service',
      serviceVersion: '1.0.0',
      serviceCommit: 'a1b2c3d4'.repeat(5),
      serviceProtocol: 'openapi-service/v1',
      openapiSha256: 'a'.repeat(64),
      configurationSchemaSha256: 'b'.repeat(64),
      configurationRevision: 4,
      configurationHash: 'c'.repeat(64),
      lastDiscoveredAt: null,
      lastConfigurationSyncAt: null,
      lastDiscoveryError: null
    },
    definition: {
      schemaVersion: 1,
      groups: [
        {
          key: 'general', label: 'General', fields: [
            { key: 'enabled', label: 'Enabled', type: 'boolean', default: true },
            { key: 'retries', label: 'Retries', type: 'number', default: 3 },
            {
              key: 'mode', label: 'Mode', type: 'single-select', default: 'auto',
              options: [{ label: 'Automatic', value: 'auto' }, { label: 'Manual', value: 'manual' }]
            },
            {
              key: 'regions', label: 'Regions', type: 'multi-select', default: ['us'], required: true,
              options: [{ label: 'US', value: 'us' }, { label: 'EU', value: 'eu' }]
            }
          ]
        },
        {
          key: 'provider', label: 'Provider', fields: [
            { key: 'baseUrl', label: 'Base URL', type: 'text', default: '', required: true },
            { key: 'notes', label: 'Notes', type: 'textarea', default: '' },
            { key: 'apiKey', label: 'API key', type: 'secret', required: true, minLength: 8 },
            { key: 'cookie', label: 'Cookie', type: 'secret' }
          ]
        }
      ]
    },
    values: {
      enabled: false,
      regions: ['eu'],
      baseUrl: 'https://example.test',
      apiKey: { configured: true },
      cookie: { configured: false }
    },
    targets: [],
    endpoints: []
  }
}

function setup(initial = createView()) {
  const view = ref(initial)
  const form = scope.run(() => useAdminServiceConfigurationForm(() => view.value))!
  return { form, view }
}

beforeEach(() => {
  scope = effectScope()
  vi.stubGlobal('useI18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${JSON.stringify(params)}` : key
  }))
})

afterEach(() => {
  scope.stop()
  vi.unstubAllGlobals()
})

describe('field rules through the form and server preparation interfaces', () => {
  const numberField = { key: 'sample', label: 'Sample', type: 'number', default: 3, minimum: 1, maximum: 9, step: 2 } satisfies ServiceConfigurationField
  const textField = { key: 'sample', label: 'Sample', type: 'text', default: 'abc', minLength: 2, maxLength: 4 } satisfies ServiceConfigurationField
  const selectField = { key: 'sample', label: 'Sample', type: 'single-select', default: 'a', options: [{ label: 'A', value: 'a' }] } satisfies ServiceConfigurationField

  function setupField(field: ServiceConfigurationField, value: ServiceConfigurationValue | { configured: boolean }) {
    const initial = createView()
    initial.definition = { schemaVersion: 1, groups: [{ key: 'general', label: 'General', fields: [field] }] }
    initial.values = { sample: value }
    return { ...setup(initial), definition: initial.definition }
  }

  const invalidCases = [
    { name: 'below minimum', field: numberField, value: 0, message: 'minimum:{"value":1}' },
    { name: 'above maximum', field: numberField, value: 10, message: 'maximum:{"value":9}' },
    { name: 'step anchored at the minimum', field: numberField, value: 2, message: 'step:{"step":2,"base":1}' },
    { name: 'step anchored at zero', field: { ...numberField, minimum: undefined }, value: 3, message: 'step:{"step":2,"base":0}' },
    { name: 'NaN', field: numberField, value: Number.NaN, message: 'invalid' },
    { name: 'infinite number', field: numberField, value: Number.POSITIVE_INFINITY, message: 'invalid' },
    { name: 'string instead of number', field: numberField, value: '3', message: 'invalid' },
    { name: 'string instead of boolean', field: { key: 'sample', label: 'Sample', type: 'boolean', default: false }, value: 'true', message: 'invalid' },
    { name: 'number instead of text', field: textField, value: 3, message: 'invalid' },
    { name: 'required text', field: { ...textField, required: true }, value: '', message: 'required' },
    { name: 'optional text minimum length', field: textField, value: '', message: 'minLength:{"count":2}' },
    { name: 'text maximum length', field: textField, value: 'abcde', message: 'maxLength:{"count":4}' },
    { name: 'textarea length', field: { ...textField, type: 'textarea' }, value: 'a', message: 'minLength:{"count":2}' },
    { name: 'removed single-select option', field: selectField, value: 'removed', message: 'unsupportedOption' },
    { name: 'wrong single-select type', field: selectField, value: ['a'], message: 'invalid' },
    { name: 'removed multi-select option', field: { ...selectField, type: 'multi-select', default: ['a'] }, value: ['removed'], message: 'unsupportedOption' },
    { name: 'wrong multi-select type', field: { ...selectField, type: 'multi-select', default: ['a'] }, value: 'a', message: 'invalid' },
    { name: 'required multi-select', field: { ...selectField, type: 'multi-select', default: ['a'], required: true }, value: [], message: 'required' }
  ] satisfies Array<{ name: string, field: ServiceConfigurationField, value: ServiceConfigurationValue, message: string }>

  it.each(invalidCases)('rejects $name from a saved view in both interfaces', ({ field, value, message }) => {
    const { form, definition } = setupField(field, value)
    expect(form.validate()).toEqual([{ name: 'sample', message: `admin.apis.routing.serviceControl.validation.${message}` }])
    expect(() => prepareServiceConfiguration({
      definition, schemaSha256: 'a'.repeat(64), stored: { values: {}, secrets: {} },
      valueUpdates: form.payload().values, secretUpdates: form.payload().secrets
    })).toThrow(ServiceConfigurationValueError)
  })

  const validCases = [
    { name: 'minimum', field: numberField, value: 1, normalized: 1 },
    { name: 'maximum', field: numberField, value: 9, normalized: 9 },
    { name: 'decimal step', field: { ...numberField, minimum: 0.1, maximum: 1, step: 0.1 }, value: 0.3, normalized: 0.3 },
    { name: 'false boolean', field: { key: 'sample', label: 'Sample', type: 'boolean', default: true }, value: false, normalized: false },
    { name: 'text at minimum length', field: textField, value: 'ab', normalized: 'ab' },
    { name: 'textarea at maximum length', field: { ...textField, type: 'textarea' }, value: 'abcd', normalized: 'abcd' },
    { name: 'single selection', field: selectField, value: 'a', normalized: 'a' },
    { name: 'duplicate selections', field: { ...selectField, type: 'multi-select', default: ['a'] }, value: ['a', 'a'], normalized: ['a'] },
    { name: 'empty optional selection', field: { ...selectField, type: 'multi-select', default: ['a'] }, value: [], normalized: [] }
  ] satisfies Array<{ name: string, field: ServiceConfigurationField, value: ServiceConfigurationValue, normalized: ServiceConfigurationValue }>

  it.each(validCases)('accepts $name and prepares it without changing the draft', ({ field, value, normalized }) => {
    const { form, definition } = setupField(field, value)
    expect(form.validate()).toEqual([])
    const prepared = prepareServiceConfiguration({
      definition, schemaSha256: 'a'.repeat(64), stored: { values: {}, secrets: {} },
      valueUpdates: form.payload().values, secretUpdates: {}
    })
    expect(prepared.values).toEqual({ sample: normalized })
    expect(prepared.publicValues).toEqual({ sample: normalized })
    expect(form.payload().values).toEqual({ sample: value })
  })

  it('keeps saved Secrets opaque and validates only replacements and explicit clears in the browser', () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ apiKeySecret: '0123456789abcdef0123456789abcdef' }))
    const field = { key: 'sample', label: 'Sample', type: 'secret', required: true, minLength: 4, maxLength: 10 } as const
    const { form, definition, view } = setupField(field, { configured: true })
    const input = { definition, schemaSha256: 'a'.repeat(64), stored: { values: {}, secrets: {} }, valueUpdates: {}, secretUpdates: {} }
    const original = prepareServiceConfiguration({ ...input, secretUpdates: { sample: 'old-secret' } })
    const stored = original.toStoredValues()
    expect(form.validate()).toEqual([])
    expect(form.payload().secrets).toEqual({})
    expect(form.secretValues.sample).toBe('')
    expect(publicStoredServiceConfiguration(definition, stored)).toEqual(view.value.values)
    expect(prepareServiceConfiguration({ ...input, stored }).hash).toBe(original.hash)

    form.setSecret('sample', 'bad')
    expect(form.validate()[0]?.message).toBe('admin.apis.routing.serviceControl.validation.minLength:{"count":4}')
    expect(() => prepareServiceConfiguration({ ...input, stored, secretUpdates: form.payload().secrets })).toThrow(ServiceConfigurationValueError)
    form.setSecret('sample', 'far-too-long-secret')
    expect(form.validate()[0]?.message).toBe('admin.apis.routing.serviceControl.validation.maxLength:{"count":10}')
    expect(() => prepareServiceConfiguration({ ...input, stored, secretUpdates: form.payload().secrets })).toThrow(ServiceConfigurationValueError)
    form.setSecret('sample', 'new-secret')
    expect(form.validate()).toEqual([])
    expect(prepareServiceConfiguration({ ...input, stored, secretUpdates: form.payload().secrets }).values.sample).toBe('new-secret')
    form.clearSecret('sample')
    expect(form.validate()[0]?.message).toBe('admin.apis.routing.serviceControl.validation.required')
    expect(() => prepareServiceConfiguration({ ...input, stored, secretUpdates: form.payload().secrets })).toThrow(ServiceConfigurationValueError)
    form.keepSecret('sample')
    expect(form.validate()).toEqual([])
    expect(form.payload().secrets).toEqual({})
  })

  it('applies minimum length to an absent optional Secret just as server preparation does', () => {
    const field = { key: 'sample', label: 'Sample', type: 'secret', minLength: 4 } as const
    const { form, definition } = setupField(field, { configured: false })
    expect(form.validate()[0]?.message).toBe('admin.apis.routing.serviceControl.validation.minLength:{"count":4}')
    expect(() => prepareServiceConfiguration({
      definition, schemaSha256: 'a'.repeat(64), stored: { values: {}, secrets: {} }, valueUpdates: {}, secretUpdates: {}
    })).toThrow(ServiceConfigurationValueError)
  })
})

describe('service configuration form', () => {
  it('loads saved values and defaults while preserving existing secrets', () => {
    const { form } = setup()

    expect(form.activeGroup.value).toBe('general')
    expect(form.pendingChangeCount.value).toBe(0)
    expect(form.secretConfigured('apiKey')).toBe(true)
    expect(form.secretValues.apiKey).toBe('')
    expect(form.validate()).toEqual([])
    expect(form.payload()).toEqual({
      expectedRevision: 4,
      values: {
        enabled: false, retries: 3, mode: 'auto', regions: ['eu'],
        baseUrl: 'https://example.test', notes: ''
      },
      secrets: {}
    })
  })

  it('preserves edits across modules and submits settings from every module', () => {
    const { form } = setup()
    form.setValue('enabled', true)
    form.activeGroup.value = 'provider'
    form.setValue('baseUrl', 'https://new.example.test')
    form.activeGroup.value = 'general'

    expect(form.booleanValue('enabled')).toBe(true)
    expect(form.pendingChangeCount.value).toBe(2)
    expect(form.groupChangeCount('general')).toBe(1)
    expect(form.groupChangeCount('provider')).toBe(1)
    expect(form.payload().values).toEqual({
      enabled: true, retries: 3, mode: 'auto', regions: ['eu'],
      baseUrl: 'https://new.example.test', notes: ''
    })

    form.setValue('enabled', false)
    expect(form.pendingChangeCount.value).toBe(1)
    expect(form.groupChangeCount('general')).toBe(0)
  })

  it('keeps saved, default, assigned and submitted arrays independent of drafts', () => {
    const original = createView()
    const { form } = setup(original)
    form.stringArrayValue('regions').push('us')
    expect(original.values.regions).toEqual(['eu'])

    const selection = ['us']
    form.setValue('regions', selection)
    selection.push('eu')
    expect(form.stringArrayValue('regions')).toEqual(['us'])
    const submitted = form.payload().values.regions as string[]
    submitted.push('eu')
    expect(form.stringArrayValue('regions')).toEqual(['us'])

    const defaultsOnly = createView()
    delete defaultsOnly.values.regions
    const defaults = setup(defaultsOnly).form
    defaults.stringArrayValue('regions').push('eu')
    expect(defaultsOnly.definition?.groups[0]?.fields[3]).toMatchObject({ default: ['us'] })
  })

  it('distinguishes replacing, explicitly clearing and keeping a secret', () => {
    const { form } = setup()
    form.setSecret('apiKey', 'replacement-key')
    form.setSecret('cookie', 'draft-cookie')
    expect(form.payload().secrets).toEqual({ apiKey: 'replacement-key', cookie: 'draft-cookie' })
    expect(form.pendingChangeCount.value).toBe(2)

    form.clearSecret('apiKey')
    expect(form.payload().secrets).toEqual({ apiKey: null, cookie: 'draft-cookie' })
    expect(form.validate()).toContainEqual({
      name: 'apiKey', message: 'admin.apis.routing.serviceControl.validation.required'
    })

    form.keepSecret('apiKey')
    expect(form.payload().secrets).toEqual({ cookie: 'draft-cookie' })
    expect(form.secretValues.apiKey).toBe('')
    expect(form.pendingChangeCount.value).toBe(1)
    expect(form.validate()).toEqual([])
  })

  it('preserves a saved secret when replacement text is erased', () => {
    const { form } = setup()
    form.setSecret('apiKey', 'replacement-key')
    form.setSecret('apiKey', '')

    expect(form.payload().secrets).toEqual({})
    expect(form.pendingChangeCount.value).toBe(0)
    expect(form.validate()).toEqual([])
  })

  it('validates hidden modules and reveals the module containing an error', () => {
    const { form } = setup()
    form.setValue('baseUrl', '')
    form.setSecret('apiKey', 'short')
    expect(form.activeGroup.value).toBe('general')
    expect(form.validate()).toEqual([
      { name: 'baseUrl', message: 'admin.apis.routing.serviceControl.validation.required' },
      { name: 'apiKey', message: 'admin.apis.routing.serviceControl.validation.minLength:{"count":8}' }
    ])

    form.revealField('baseUrl')
    expect(form.activeGroup.value).toBe('provider')
    form.setValue('regions', [])
    expect(form.validate()).toContainEqual({
      name: 'regions', message: 'admin.apis.routing.serviceControl.validation.required'
    })
  })

  it('keeps drafts when only availability or instance status changes', async () => {
    const { form, view } = setup()
    form.activeGroup.value = 'provider'
    form.setValue('notes', 'unsaved note')
    form.setSecret('apiKey', 'replacement-key')
    const refreshed = createView()
    refreshed.connection.availability = 'degraded'
    refreshed.targets = [{
      id: 'target-1', baseUrl: 'https://example.test', enabled: true,
      availability: 'offline', configurationRevision: 4, configurationHash: null,
      configurationStatus: 'error', configurationState: null,
      lastConfigurationSyncAt: null, lastError: 'Unavailable'
    }]
    view.value = refreshed
    await nextTick()

    expect(form.activeGroup.value).toBe('provider')
    expect(form.stringValue('notes')).toBe('unsaved note')
    expect(form.payload().secrets).toEqual({ apiKey: 'replacement-key' })
    expect(form.pendingChangeCount.value).toBe(2)
  })

  it('loads a new saved revision and clears secret drafts after saving', async () => {
    const { form, view } = setup()
    form.activeGroup.value = 'provider'
    form.setValue('retries', 8)
    form.setSecret('apiKey', 'replacement-key')
    view.value = {
      ...view.value,
      connection: { ...view.value.connection, configurationRevision: 5 },
      values: { ...view.value.values, retries: 8 }
    }
    await nextTick()

    expect(form.activeGroup.value).toBe('provider')
    expect(form.numberValue('retries')).toBe(8)
    expect(form.secretValues.apiKey).toBe('')
    expect(form.payload()).toMatchObject({ expectedRevision: 5, secrets: {} })
    expect(form.pendingChangeCount.value).toBe(0)
  })

  it('removes old fields and secret drafts when a module is removed', async () => {
    const { form, view } = setup()
    form.activeGroup.value = 'provider'
    form.setValue('notes', 'draft')
    form.setSecret('apiKey', 'replacement-key')
    view.value.definition!.groups = view.value.definition!.groups.filter(group => group.key === 'general')
    await nextTick()

    expect(form.activeGroup.value).toBe('general')
    expect(form.payload().values).toEqual({ enabled: false, retries: 3, mode: 'auto', regions: ['eu'] })
    expect(form.payload().secrets).toEqual({})
    expect(form.secretValues).toEqual({})
    expect(form.pendingChangeCount.value).toBe(0)
  })

  it('resets drafts when switching to a different Service with the same schema and revision', async () => {
    const { form, view } = setup()
    form.setValue('retries', 8)
    form.setSecret('apiKey', 'replacement-key')
    view.value.connection.upstreamServiceId = 'upstream-2'
    await nextTick()

    expect(form.numberValue('retries')).toBe(3)
    expect(form.payload().secrets).toEqual({})
    expect(form.secretValues.apiKey).toBe('')
    expect(form.pendingChangeCount.value).toBe(0)
  })

  it('discards all ordinary and secret changes across modules', () => {
    const { form } = setup()
    form.setValue('enabled', true)
    form.setValue('regions', ['us'])
    form.activeGroup.value = 'provider'
    form.setValue('notes', 'draft')
    form.clearSecret('apiKey')
    form.setSecret('cookie', 'draft-cookie')
    form.reset()

    expect(form.activeGroup.value).toBe('provider')
    expect(form.booleanValue('enabled')).toBe(false)
    expect(form.stringArrayValue('regions')).toEqual(['eu'])
    expect(form.stringValue('notes')).toBe('')
    expect(form.pendingChangeCount.value).toBe(0)
    expect(form.payload().secrets).toEqual({})
    expect(form.secretValues).toEqual({ apiKey: '', cookie: '' })
    expect(form.validate()).toEqual([])
  })

  it('clears the form when no configuration definition is available', async () => {
    const { form, view } = setup()
    form.setSecret('apiKey', 'replacement-key')
    view.value.definition = null
    await nextTick()

    expect(form.activeGroup.value).toBe('')
    expect(form.groups.value).toEqual([])
    expect(form.payload()).toEqual({ expectedRevision: 4, values: {}, secrets: {} })
    expect(form.secretValues).toEqual({})
    expect(form.validate()).toEqual([])
  })
})
