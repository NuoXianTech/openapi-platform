import { computed, getCurrentScope, onScopeDispose, reactive, ref, watch } from 'vue'
import { SUPPORTED_OAUTH_PROVIDERS } from '#shared/types/oauth'
import type { AdminSettingsKey } from '~/composables/admin/use-admin-settings-page'
import { useAdminSettingsPage } from '~/composables/admin/use-admin-settings-page'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import { parseFetchError } from '~/utils/client-error'

interface AdminOauthProviderItem {
  provider: string
  displayName: string
  icon: string
  scopes: string[]
  clientId: string
  clientSecret: string
  isEnabled: boolean
  callbackUrl: string
  authorizeUrl: string
  tokenUrl: string
  userInfoUrl: string
}

interface AdminOauthProviderForm {
  clientId: string
  clientSecret: string
  isEnabled: boolean
  secretVisible: boolean
  open: boolean
}

interface AdminOauthProviderUpdateBody {
  provider: string
  clientId: string
  isEnabled: boolean
  clientSecret?: string
}

function createProviderForm(): AdminOauthProviderForm {
  return {
    clientId: '',
    clientSecret: '',
    isEnabled: false,
    secretVisible: false,
    open: false
  }
}

function buildProviderUpdate(
  provider: string,
  form: AdminOauthProviderForm
): AdminOauthProviderUpdateBody {
  return {
    provider,
    clientId: form.clientId,
    isEnabled: form.isEnabled,
    ...(form.clientSecret ? { clientSecret: form.clientSecret } : {})
  }
}

export function useAdminUserSessionSettings() {
  const toast = useToast()
  const { t } = useI18n()
  const { copyText } = useCopyFeedback()
  const settings = useAdminSettingsPage()
  const providers = usePrivateResource<AdminOauthProviderItem[]>({
    path: '/api/admin/oauth-providers/list',
    defaultData: () => []
  })
  const forms = reactive<Record<string, AdminOauthProviderForm>>(
    Object.fromEntries(SUPPORTED_OAUTH_PROVIDERS.map(provider => [provider, createProviderForm()]))
  )
  const items = computed(() => providers.data.value)
  const oauthPolicyKeys = ['oauthForceBinding'] as const satisfies readonly AdminSettingsKey[]
  const oauthPolicySection = settings.createSection(oauthPolicyKeys)
  const isOauthSaving = ref(false)
  let disposed = false
  if (getCurrentScope()) onScopeDispose(() => { disposed = true })
  const baselines = reactive<Record<string, Pick<AdminOauthProviderForm, 'clientId' | 'isEnabled'>>>({})

  const registrationModeItems = computed(() => [
    { label: t('admin.system.session.registration.mode.options.open'), value: 'open' },
    { label: t('admin.system.session.registration.mode.options.invite'), value: 'invite' },
    { label: t('admin.system.session.registration.mode.options.closed'), value: 'closed' }
  ])
  const emailFilterModeItems = computed(() => [
    { label: t('admin.system.session.emailFilter.options.off'), value: 'off' },
    { label: t('admin.system.session.emailFilter.options.whitelist'), value: 'whitelist' },
    { label: t('admin.system.session.emailFilter.options.blacklist'), value: 'blacklist' }
  ])

  function getForm(provider: string): AdminOauthProviderForm {
    return forms[provider] ?? (forms[provider] = createProviderForm())
  }

  function acceptProviders(list: AdminOauthProviderItem[], submitted?: Map<string, AdminOauthProviderForm>) {
    for (const item of list) {
      const form = getForm(item.provider)
      const expected = submitted?.get(item.provider) ?? baselines[item.provider] ?? createProviderForm()
      if (form.clientId === expected.clientId) form.clientId = item.clientId || ''
      if (form.isEnabled === expected.isEnabled) form.isEnabled = item.isEnabled
      const sent = submitted?.get(item.provider)
      if (sent && form.clientSecret === sent.clientSecret) form.clientSecret = ''
      baselines[item.provider] = { clientId: item.clientId || '', isEnabled: item.isEnabled }
    }
  }
  watch(items, list => acceptProviders(list), { immediate: true, flush: 'sync' })

  const changedProviderCount = computed(() => items.value.filter((item) => {
    const form = getForm(item.provider)
    return form.clientId !== baselines[item.provider]?.clientId
      || form.clientSecret.length > 0
      || form.isEnabled !== baselines[item.provider]?.isEnabled
  }).length)
  const oauthChangedCount = computed(() => changedProviderCount.value + oauthPolicySection.changedCount.value)
  const isOauthDirty = computed(() => oauthChangedCount.value > 0)
  const isOauthReady = computed(() => !disposed && !settings.loading.value && !settings.saving.value && !providers.loading.value && items.value.length === SUPPORTED_OAUTH_PROVIDERS.length)

  async function saveOauthSettings(): Promise<void> {
    if (!isOauthReady.value || !isOauthDirty.value || isOauthSaving.value) return
    isOauthSaving.value = true
    const submittedProviders = new Map(items.value.map(item => [item.provider, { ...getForm(item.provider) }]))
    try {
      const result = await settings.saveWith({
        keys: oauthPolicyKeys,
        successKey: 'admin.system.session.oauth.feedback.saved',
        failureKey: 'admin.system.session.oauth.feedback.saveFailed',
        request: submitted => $fetch<{
          oauthForceBinding: boolean
          providers: Array<Pick<AdminOauthProviderItem, 'provider' | 'clientId' | 'clientSecret' | 'isEnabled'>>
        }>('/api/admin/oauth-providers/update-all', {
          method: 'PUT',
          body: {
            oauthForceBinding: submitted.oauthForceBinding,
            providers: items.value.map(item => buildProviderUpdate(item.provider, submittedProviders.get(item.provider)!))
          }
        })
      })
      if (!result || disposed) return
      const updated = items.value.map(item => ({ ...item, ...result.providers.find(provider => provider.provider === item.provider) }))
      acceptProviders(updated, submittedProviders)
      providers.data.value = updated
      // Start a new read to supersede any older in-flight refresh. Its failure
      // cannot turn the accepted mutation into another save attempt.
      await providers.refresh()
      if (!disposed && providers.error.value) {
        toast.add({ title: parseFetchError(providers.error.value, t('common.feedback.loadFailed')), color: 'error' })
      }
    } finally {
      isOauthSaving.value = false
    }
  }

  async function copyCallback(item: AdminOauthProviderItem): Promise<void> {
    await copyText(item.callbackUrl, {
      errorTitle: t('admin.system.session.oauth.feedback.copyFailed')
    })
  }

  return {
    form: settings.form,
    secrets: settings.secrets,
    saving: settings.saving,
    save: settings.save,
    dirty: settings.dirty,
    changedKeys: settings.changedKeys,
    reset: settings.reset,
    createSection: settings.createSection,
    registrationModeItems,
    emailFilterModeItems,
    loading: providers.loading,
    refresh: providers.refresh,
    items,
    forms,
    getForm,
    isOauthDirty,
    isOauthReady,
    oauthChangedCount,
    isOauthSaving,
    saveOauthSettings,
    copyCallback
  }
}
