import { computed, reactive, ref, watch } from 'vue'
import type { FormError } from '@nuxt/ui'
import type {
  ServiceConfigurationField,
  ServiceConfigurationValue,
  ServiceConfigurationView
} from '#shared/types/service-control'

export interface ServiceConfigurationFormPayload {
  expectedRevision: number
  values: Record<string, ServiceConfigurationValue>
  secrets: Record<string, string | null>
}

function cloneValue(value: ServiceConfigurationValue): ServiceConfigurationValue {
  return Array.isArray(value) ? [...value] : value
}

function isConfigurationValue(value: unknown): value is ServiceConfigurationValue {
  return typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || (Array.isArray(value) && value.every(item => typeof item === 'string'))
}

function clearRecord(record: Record<string, unknown>) {
  for (const key of Object.keys(record)) Reflect.deleteProperty(record, key)
}

export function useAdminServiceConfigurationForm(getView: () => ServiceConfigurationView) {
  const { t } = useI18n()
  const groups = computed(() => getView().definition?.groups ?? [])
  const activeGroup = ref('')
  const values = reactive<Record<string, ServiceConfigurationValue>>({})
  const secretValues = reactive<Record<string, string>>({})
  const secretDirty = reactive<Record<string, boolean>>({})
  const secretCleared = reactive<Record<string, boolean>>({})

  function savedValue(field: Exclude<ServiceConfigurationField, { type: 'secret' }>) {
    const value = getView().values[field.key]
    return isConfigurationValue(value) ? value : field.default
  }

  function reset() {
    clearRecord(values)
    clearRecord(secretValues)
    clearRecord(secretDirty)
    clearRecord(secretCleared)
    for (const group of groups.value) {
      for (const field of group.fields) {
        if (field.type === 'secret') {
          secretValues[field.key] = ''
          secretDirty[field.key] = false
          secretCleared[field.key] = false
        } else {
          values[field.key] = cloneValue(savedValue(field))
        }
      }
    }
    if (!groups.value.some(group => group.key === activeGroup.value)) {
      activeGroup.value = groups.value[0]?.key ?? ''
    }
  }

  // Availability and Target refreshes must not erase edits. Only a new Service
  // or an actual configuration/schema change resets the form.
  watch(() => {
    const view = getView()
    return JSON.stringify({
      service: view.connection.upstreamServiceId,
      revision: view.connection.configurationRevision,
      definition: view.definition,
      values: view.values
    })
  }, reset, { immediate: true })

  const changedFields = computed(() => new Set(groups.value.flatMap(group => (
    group.fields.filter(field => field.type === 'secret'
      ? secretDirty[field.key]
      : JSON.stringify(values[field.key]) !== JSON.stringify(savedValue(field)))
      .map(field => field.key)
  ))))
  const pendingChangeCount = computed(() => changedFields.value.size)

  function groupChangeCount(key: string): number {
    return groups.value.find(group => group.key === key)?.fields
      .filter(field => changedFields.value.has(field.key)).length ?? 0
  }

  function revealField(key: string) {
    const group = groups.value.find(group => group.fields.some(field => field.key === key))
    if (group) activeGroup.value = group.key
  }

  function secretConfigured(key: string): boolean {
    const value = getView().values[key]
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && 'configured' in value && value.configured)
  }

  function booleanValue(key: string): boolean {
    return values[key] === true
  }

  function numberValue(key: string): number {
    return typeof values[key] === 'number' ? values[key] : 0
  }

  function stringValue(key: string): string {
    return typeof values[key] === 'string' ? values[key] : ''
  }

  function stringArrayValue(key: string): string[] {
    return Array.isArray(values[key]) ? values[key] as string[] : []
  }

  function setValue(key: string, value: ServiceConfigurationValue) {
    values[key] = cloneValue(value)
  }

  function setSecret(key: string, value: string) {
    secretValues[key] = value
    secretDirty[key] = value.length > 0
    secretCleared[key] = false
  }

  function clearSecret(key: string) {
    secretValues[key] = ''
    secretDirty[key] = true
    secretCleared[key] = true
  }

  function keepSecret(key: string) {
    secretValues[key] = ''
    secretDirty[key] = false
    secretCleared[key] = false
  }

  function validateField(field: ServiceConfigurationField): string | null {
    if (field.type === 'secret') {
      const value = secretValues[field.key] ?? ''
      const preserved = secretConfigured(field.key) && !secretDirty[field.key]
      if (field.required && !preserved && (!value || secretCleared[field.key])) {
        return t('admin.apis.routing.serviceControl.validation.required')
      }
      if (value && field.minLength !== undefined && value.length < field.minLength) {
        return t('admin.apis.routing.serviceControl.validation.minLength', { count: field.minLength })
      }
      if (value && field.maxLength !== undefined && value.length > field.maxLength) {
        return t('admin.apis.routing.serviceControl.validation.maxLength', { count: field.maxLength })
      }
      return null
    }
    const value = values[field.key]
    if (field.type === 'text' || field.type === 'textarea') {
      if (typeof value !== 'string') return t('admin.apis.routing.serviceControl.validation.invalid')
      if (field.required && !value) return t('admin.apis.routing.serviceControl.validation.required')
      if (field.minLength !== undefined && value.length < field.minLength) {
        return t('admin.apis.routing.serviceControl.validation.minLength', { count: field.minLength })
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return t('admin.apis.routing.serviceControl.validation.maxLength', { count: field.maxLength })
      }
    }
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      return t('admin.apis.routing.serviceControl.validation.invalid')
    }
    if (field.type === 'multi-select' && field.required && (!Array.isArray(value) || value.length === 0)) {
      return t('admin.apis.routing.serviceControl.validation.required')
    }
    return null
  }

  function validate(): FormError<string>[] {
    return groups.value.flatMap(group => group.fields.flatMap((field) => {
      const message = validateField(field)
      return message ? [{ name: field.key, message }] : []
    }))
  }

  function payload(): ServiceConfigurationFormPayload {
    const secrets: Record<string, string | null> = {}
    for (const [key, dirty] of Object.entries(secretDirty)) {
      if (dirty) secrets[key] = secretCleared[key] ? null : secretValues[key] ?? ''
    }
    return {
      expectedRevision: getView().connection.configurationRevision,
      values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, cloneValue(value)])),
      secrets
    }
  }

  return {
    activeGroup, groups, pendingChangeCount, groupChangeCount, revealField,
    booleanValue, numberValue, stringValue, stringArrayValue, setValue,
    secretValues, secretDirty, secretCleared, secretConfigured, setSecret, clearSecret, keepSecret,
    reset, validate, payload
  }
}
