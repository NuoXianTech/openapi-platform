<script setup lang="ts">
import { en, zh_cn } from '@nuxt/ui/locale'
import { DEFAULT_LOCALE } from '#shared/config/locale-defaults'
import { appThemeUi, resolveAppTheme } from '~/constants/app-ui'

// 站点元信息（标题模板、favicon、描述）统一由 siteSettings 提供，
// 各 page 通过 useHead({ title }) 声明本页标题，模板自动拼上 siteName。
const { settings } = useSiteSettings()
const { locale, setLocale } = useI18n()
const { user } = useAuth()
const uiLocale = computed(() => locale.value === 'en-US' ? en : zh_cn)
const route = useRoute()
const theme = computed(() => resolveAppTheme(route.meta))
const themeUi = computed(() => appThemeUi[theme.value])

const link = computed(() => [
  { rel: 'icon' as const, type: 'image/x-icon', href: settings.value.siteImg || '/favicon.ico' }
])

useHead({
  titleTemplate: title => (typeof title === 'string' && title.length)
    ? `${title} - ${settings.value.siteName}`
    : settings.value.siteName,
  htmlAttrs: { lang: () => locale.value || DEFAULT_LOCALE, 'data-app-theme': () => theme.value },
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
  <UTheme :ui="themeUi">
    <UApp
      :locale="uiLocale"
      :toaster="{ position: 'bottom-right', max: 3, progress: false }"
    >
      <NuxtLayout>
        <CommonPageOutlet />
      </NuxtLayout>
    </UApp>
  </UTheme>
</template>
