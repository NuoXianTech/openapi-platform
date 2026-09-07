import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceConfigurationView } from '#shared/types/service-control'
import { useAdminServiceConfigurationForm } from '@/composables/admin/use-admin-service-configuration-form'

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
