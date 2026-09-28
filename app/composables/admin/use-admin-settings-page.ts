import { computed, getCurrentScope, onMounted, onScopeDispose, reactive, ref, type ComputedRef } from 'vue'
import type { PublicSiteSettings, SystemSettings } from '#shared/types/site-settings'
import { SITE_SETTINGS_DEFAULTS } from '#shared/config/site-defaults'
import { PUBLIC_SITE_SETTINGS_KEY } from '~/composables/use-site-settings'
import { parseFetchError } from '~/utils/client-error'

export type AdminSettingsForm = SystemSettings
export type AdminSettingsKey = keyof AdminSettingsForm

export interface AdminSettingsSecrets {
  hasRegistrationInviteCode: boolean
  hasSmtpPass: boolean
  hasOauthGithubClientSecret: boolean
  hasOauthQqClientSecret: boolean
  hasTurnstileSecretKey: boolean
}

export interface AdminSettingsSectionState {
  dirty: ComputedRef<boolean>
  changedCount: ComputedRef<number>
  saving: ComputedRef<boolean>
  disabled: ComputedRef<boolean>
  save: () => Promise<boolean>
  reset: () => void
}

interface AdminSettingsResponse extends Partial<AdminSettingsForm> {
  secrets?: Partial<AdminSettingsSecrets>
  public?: PublicSiteSettings
}

const writeOnlySecretKeys: readonly AdminSettingsKey[] = [
  'registrationInviteCode', 'smtpPass', 'turnstileSecretKey'
]
const EMPTY_SETTINGS_SECRETS: AdminSettingsSecrets = {
  hasRegistrationInviteCode: false, hasSmtpPass: false,
  hasOauthGithubClientSecret: false, hasOauthQqClientSecret: false,
  hasTurnstileSecretKey: false
}

function normalizeForm(value: Partial<AdminSettingsForm>): AdminSettingsForm {
  const result = { ...SITE_SETTINGS_DEFAULTS }
  for (const key of Object.keys(result) as AdminSettingsKey[]) {
    if (value[key] !== undefined && value[key] !== null) result[key] = value[key] as never
  }
  return result
}

export function useAdminSettingsPage() {
  const toast = useToast()
  const { t } = useI18n()
  const form = reactive<AdminSettingsForm>({ ...SITE_SETTINGS_DEFAULTS })
  const pristine = ref<AdminSettingsForm>({ ...SITE_SETTINGS_DEFAULTS })
  const secrets = reactive<AdminSettingsSecrets>({ ...EMPTY_SETTINGS_SECRETS })
  const saving = ref(false)
  const savingKeys = ref<readonly AdminSettingsKey[]>([])
  const loading = ref(true)
  let disposed = false
  if (getCurrentScope()) onScopeDispose(() => { disposed = true })

  // Read private configuration only after mounting, never into the SSR payload.
  async function load() {
    const started = { ...form }
    const baseline = { ...pristine.value }
    loading.value = true
    try {
      const response = await $fetch<AdminSettingsResponse | null>('/api/admin/settings/get')
      if (disposed || !response) return
      const next = normalizeForm(response)
      for (const key of Object.keys(next) as AdminSettingsKey[]) {
        if (form[key] === started[key] && started[key] === baseline[key]) form[key] = next[key] as never
      }
      pristine.value = next
      if (response.secrets) Object.assign(secrets, response.secrets)
    } catch (error: unknown) {
      if (!disposed) toast.add({ title: parseFetchError(error, t('admin.system.feedback.loadFailed')), color: 'error' })
    } finally {
      loading.value = false
    }
  }
  onMounted(() => { void load() })

  const changedKeys = computed(() => (Object.keys(pristine.value) as AdminSettingsKey[])
    .filter(key => form[key] !== pristine.value[key]))
  const dirty = computed(() => changedKeys.value.length > 0)
  function getChangedKeys(keys?: readonly AdminSettingsKey[]) {
    return keys ? keys.filter(key => form[key] !== pristine.value[key]) : changedKeys.value
  }
  function reset(keys: readonly AdminSettingsKey[] = changedKeys.value) {
    for (const key of keys) form[key] = pristine.value[key] as never
  }

  // All writes, including the combined OAuth update, share one admission and
  // accept only the captured submission. Callers cannot mark mutable drafts saved.
  async function saveWith<T extends AdminSettingsResponse>(options: {
    keys: readonly AdminSettingsKey[]
    request: (submitted: Readonly<AdminSettingsForm>) => Promise<T>
    resetKeys?: readonly AdminSettingsKey[]
    successKey?: 'admin.system.feedback.saved' | 'admin.system.session.oauth.feedback.saved'
    failureKey?: 'admin.system.feedback.saveFailed' | 'admin.system.session.oauth.feedback.saveFailed'
  }): Promise<T | null> {
    if (disposed || loading.value || saving.value) return null
    const submitted = { ...form }
    const keys = [...options.keys]
    saving.value = true
    savingKeys.value = keys
    try {
      let response: T
      try {
        response = await options.request(submitted)
      } catch (error: unknown) {
        if (!disposed) toast.add({ title: parseFetchError(error, t(options.failureKey ?? 'admin.system.feedback.saveFailed')), color: 'error' })
        return null
      }
      if (disposed) return null
      const canReset = keys.every(key => form[key] === submitted[key])
      const nextPristine = { ...pristine.value }
      for (const key of keys) {
        const saved = writeOnlySecretKeys.includes(key) ? '' : response[key] ?? submitted[key]
        if (form[key] === submitted[key]) form[key] = saved as never
        nextPristine[key] = saved as never
      }
      pristine.value = nextPristine
      for (const key of canReset ? options.resetKeys ?? [] : []) {
        if (form[key] === submitted[key]) form[key] = pristine.value[key] as never
      }
      if (response.public) useNuxtData<PublicSiteSettings>(PUBLIC_SITE_SETTINGS_KEY).data.value = response.public
      if (response.secrets) Object.assign(secrets, response.secrets)
      toast.add({ title: t(options.successKey ?? 'admin.system.feedback.saved'), color: 'success' })
      return response
    } finally {
      saving.value = false
      savingKeys.value = []
    }
  }

  async function save(keys?: readonly AdminSettingsKey[], options: { resetKeys?: readonly AdminSettingsKey[] } = {}): Promise<boolean> {
    if (disposed || loading.value || saving.value) return false
    const keysToSave = getChangedKeys(keys)
    if (!keysToSave.length) {
      reset(options.resetKeys ?? [])
      return true
    }
    return Boolean(await saveWith({
      keys: keysToSave,
      resetKeys: options.resetKeys,
      request: (submitted) => {
        const body: Partial<AdminSettingsForm> = {}
        for (const key of keysToSave) {
          if (writeOnlySecretKeys.includes(key) && !String(submitted[key] ?? '').trim()) continue
          body[key] = submitted[key] as never
        }
        return $fetch<AdminSettingsResponse>('/api/admin/settings/update', { method: 'PUT', body })
      }
    }))
  }

  function createSection(keys: readonly AdminSettingsKey[]): AdminSettingsSectionState {
    const changed = computed(() => getChangedKeys(keys))
    const isSaving = computed(() => saving.value && savingKeys.value.some(key => keys.includes(key)))
    return {
      dirty: computed(() => changed.value.length > 0),
      changedCount: computed(() => changed.value.length),
      saving: isSaving,
      disabled: computed(() => disposed || loading.value || (saving.value && !isSaving.value)),
      save: () => save(keys),
      reset: () => reset(keys)
    }
  }
  return { form, secrets, saving, loading, save, saveWith, dirty, changedKeys, reset, createSection }
}
