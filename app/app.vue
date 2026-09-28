<script setup lang="ts">
import { en, zh_cn } from '@nuxt/ui/locale'
import { DEFAULT_LOCALE } from '#shared/config/locale-defaults'

// 站点元信息（标题模板、favicon、描述）统一由 siteSettings 提供，
// 各 page 通过 useHead({ title }) 声明本页标题，模板自动拼上 siteName。
const { settings } = useSiteSettings()
const { locale, setLocale } = useI18n()
const { user } = useAuth()
const uiLocale = computed(() => locale.value === 'en-US' ? en : zh_cn)

const link = computed(() => [
  { rel: 'icon' as const, type: 'image/x-icon', href: settings.value.siteImg || '/favicon.ico' }
])

useHead({
  titleTemplate: title => (typeof title === 'string' && title.length)
    ? `${title} - ${settings.value.siteName}`
    : settings.value.siteName,
  htmlAttrs: { lang: () => locale.value || DEFAULT_LOCALE },
  meta: [
    { name: 'description', content: () => settings.value.siteDescription }
  ],
  link
})

if (import.meta.client) {
  watch(() => user.value?.locale, (preferredLocale) => {
    if (!preferredLocale || preferredLocale === locale.value) return
    void setLocale(preferredLocale)
  }, { immediate: true })
}
</script>

<template>
  <UApp :locale="uiLocale">
    <NuxtLoadingIndicator
      color="#18181b"
      :height="3"
    />
    <NuxtLayout>
      <CommonPageOutlet />
    </NuxtLayout>
  </UApp>
</template>
