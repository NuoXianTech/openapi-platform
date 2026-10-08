import type { ServiceConfigurationField, ServiceConfigurationValue } from '../service-control'

type FieldErrorCode = 'invalid' | 'required' | 'minLength' | 'maxLength'
  | 'minimum' | 'maximum' | 'step' | 'unsupportedOption'

type FieldResult = { valid: true, value: ServiceConfigurationValue } | {
  valid: false
  code: FieldErrorCode
  message: string
  params?: Record<string, number>
}

function invalid(
  field: ServiceConfigurationField,
  code: FieldErrorCode,
  message: string,
  params?: Record<string, number>
): FieldResult {
  return { valid: false, code, message: `${field.key} ${message}`, ...(params ? { params } : {}) }
}

/** Shared field semantics for browser drafts and server configuration preparation.
 * Values are never coerced or mutated; issues never contain the submitted value.
 * A preserved Secret is resolved by the caller, not represented as plaintext here. */
export function parseServiceConfigurationField(field: ServiceConfigurationField, value: unknown): FieldResult {
  switch (field.type) {
    case 'boolean':
      return typeof value === 'boolean'
        ? { valid: true, value }
        : invalid(field, 'invalid', 'must be a boolean')
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return invalid(field, 'invalid', 'must be a finite number')
      }
      if (field.minimum !== undefined && value < field.minimum) {
        return invalid(field, 'minimum', `must be at least ${field.minimum}`, { value: field.minimum })
      }
      if (field.maximum !== undefined && value > field.maximum) {
        return invalid(field, 'maximum', `must be at most ${field.maximum}`, { value: field.maximum })
      }
      if (field.step !== undefined) {
        const base = field.minimum ?? 0
        const steps = (value - base) / field.step
        if (Math.abs(steps - Math.round(steps)) > Number.EPSILON * 16) {
          return invalid(field, 'step', `must use step ${field.step}`, { step: field.step, base })
        }
      }
      return { valid: true, value }
    }
    case 'text':
    case 'textarea':
    case 'secret': {
      if (typeof value !== 'string') return invalid(field, 'invalid', 'must be a string')
      if (field.required && value.length === 0) return invalid(field, 'required', 'is required')
      if (field.minLength !== undefined && value.length < field.minLength) {
        return invalid(field, 'minLength', `must contain at least ${field.minLength} characters`, { count: field.minLength })
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return invalid(field, 'maxLength', `must contain at most ${field.maxLength} characters`, { count: field.maxLength })
      }
      return { valid: true, value }
    }
    case 'single-select':
      if (typeof value !== 'string') return invalid(field, 'invalid', 'must be a string')
      if (!field.options.some(option => option.value === value)) {
        return invalid(field, 'unsupportedOption', 'contains an unsupported option')
      }
      return { valid: true, value }
    case 'multi-select': {
      if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        return invalid(field, 'invalid', 'must be a string array')
      }
      const allowed = new Set(field.options.map(option => option.value))
      const unique = Array.from(new Set(value as string[]))
      if (unique.some(item => !allowed.has(item))) {
        return invalid(field, 'unsupportedOption', 'contains an unsupported option')
      }
      if (field.required && unique.length === 0) return invalid(field, 'required', 'is required')
      return { valid: true, value: unique }
    }
  }
}
