import { isSupportedLocale, type SupportedLocale } from '#shared/config/locale-defaults'
import type { UserProfileData } from '~/types/user-settings'
import { onScopeDispose, watch } from 'vue'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'

export function useUserProfileSettings() {
  const toast = useToast()
  const { t, locale, setLocale } = useI18n()
  const { user, updateProfile: saveProfile, updateLocalePreference } = useAuth()

  const resource = usePrivateResource<UserProfileData | null>({
    path: '/api/user/profile', defaultData: () => null, immediate: false
  })
  const { data: profile, loading: isProfileLoading } = resource
  let disposed = false
  let generation = 0
  watch(() => user.value?.id, () => {
    generation += 1
    resource.invalidate()
    profile.value = null
  }, { flush: 'sync' })
  onScopeDispose(() => { disposed = true; generation += 1 })

  async function loadProfile(): Promise<void> {
    await resource.refresh()
  }

  async function updateProfile(displayName: string): Promise<void> {
    if (disposed) return
    const version = generation
    resource.invalidate()
    const saved = await saveProfile(displayName)
    if (!saved || disposed || version !== generation) return
    resource.invalidate()
    profile.value = saved
    toast.add({ title: t('user.settings.profile.updated'), color: 'success' })
  }

  async function updateLanguagePreference(nextLocale: SupportedLocale): Promise<void> {
    if (disposed) return
    const version = generation
    const previousLocale = locale.value
    await setLocale(nextLocale)
    if (disposed || version !== generation) return
    try {
      const savedLocale = await updateLocalePreference(nextLocale)
      if (savedLocale === undefined || disposed || version !== generation) return
      resource.invalidate()
      if (profile.value) {
        profile.value = { ...profile.value, locale: savedLocale }
      }
      toast.add({ title: t('user.settings.language.updated'), color: 'success' })
    } catch (error) {
      if (disposed || version !== generation) return
      if (isSupportedLocale(previousLocale)) {
        await setLocale(previousLocale)
      }
      throw error
    }
  }

  async function requestEmailChange(currentPassword: string, newEmail: string): Promise<string> {
    const response = await $fetch('/api/user/request-email-change', {
      method: 'POST',
      body: { currentPassword, newEmail }
    })
    toast.add({
      title: t('user.settings.email.verificationSent'),
      description: t('user.settings.email.verificationSentDescription', { email: response.pendingEmail }),
      color: 'success'
    })
    return response.pendingEmail
  }

  return {
    profile,
    isProfileLoading,
    loadProfile,
    updateProfile,
    updateLanguagePreference,
    requestEmailChange
  }
}
