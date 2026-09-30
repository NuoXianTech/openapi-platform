<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import SiteBrand from './SiteBrand.vue'
import { ADMIN_OVERVIEW_PATH, USER_OVERVIEW_PATH } from '~/constants/dashboard-config'
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from '#shared/config/locale-defaults'

const route = useRoute()
const { user, logout, updateLocalePreference } = useAuth()
const { registrationEnabled } = useSiteSettings()
const { t, locale, locales, setLocale } = useI18n()
const toast = useToast()
const isChangingLocale = ref(false)
const mobileMenuOpen = ref(false)
const isDesktop = useMediaQuery('(min-width: 1024px)')
const headerRef = useTemplateRef<HTMLElement>('header')
const menuButton = useTemplateRef<{ $el: HTMLElement }>('menuButton')
const menuId = useId()

const navigation = computed(() => [
  { label: t('public.navigation.home'), to: '/' },
  { label: t('public.navigation.catalog'), to: '/docs' },
  { label: t('public.home.stats'), to: '/stats' },
  { label: t('public.home.friendLinks'), to: '/friend-links' }
])

const dashboardPath = computed(() => user.value?.role === 'admin' ? ADMIN_OVERVIEW_PATH : USER_OVERVIEW_PATH)
const dashboardLabel = computed(() => user.value?.role === 'admin'
  ? t('public.home.adminDashboard')
  : t('public.home.userDashboard'))

const languages = computed(() => locales.value.flatMap((item) => {
  const code = typeof item === 'string' ? item : item.code
  if (!isSupportedLocale(code)) return []
  return [{ code, label: typeof item === 'string' ? item : item.name || item.code }]
}))

const languageItems = computed<DropdownMenuItem[]>(() => languages.value.map(item => ({
  label: item.label,
  active: item.code === locale.value,
  disabled: isChangingLocale.value,
  trailingIcon: item.code === locale.value ? 'i-mdi-check' : undefined,
  onSelect: () => void handleLocaleChange(item.code)
})))

function isActive(path: string): boolean {
  return path === '/' ? route.path === '/' : route.path.startsWith(path)
}

async function closeMobileMenu(restoreFocus = false) {
  if (!mobileMenuOpen.value) return
  mobileMenuOpen.value = false
  if (restoreFocus) {
    await nextTick()
    menuButton.value?.$el.focus()
  }
}

function onEscape(event: KeyboardEvent) {
  if (!mobileMenuOpen.value) return
  event.preventDefault()
  event.stopPropagation()
  void closeMobileMenu(true)
}

watch(() => route.fullPath, () => void closeMobileMenu())
watch(isDesktop, (desktop) => {
  if (desktop) void closeMobileMenu()
})
onClickOutside(headerRef, () => void closeMobileMenu())

async function handleLogout(): Promise<void> {
  await logout()
  await closeMobileMenu()
  await navigateTo('/')
}

async function handleLocaleChange(nextLocale: SupportedLocale): Promise<void> {
  if (nextLocale === locale.value || isChangingLocale.value) return

  const previousLocale = isSupportedLocale(locale.value) ? locale.value : DEFAULT_LOCALE
  isChangingLocale.value = true
  try {
    await setLocale(nextLocale)
    if (user.value) await updateLocalePreference(nextLocale)
  } catch {
    await setLocale(previousLocale)
    toast.add({ title: t('common.feedback.updateFailed'), color: 'error' })
  } finally {
    isChangingLocale.value = false
  }
}
</script>

<template>
  <header ref="header" class="site-header" @keydown.esc="onEscape">
    <div class="site-header__inner">
      <SiteBrand class="site-header__brand" @click="closeMobileMenu()" />

      <UButton
        ref="menuButton"
        color="neutral"
        variant="ghost"
        size="sm"
        square
        :icon="mobileMenuOpen ? 'i-mdi-close' : 'i-mdi-menu'"
        :aria-label="mobileMenuOpen ? t('public.navigation.closeMenu') : t('public.navigation.openMenu')"
        :aria-expanded="mobileMenuOpen"
        :aria-controls="menuId"
        class="site-header__tool site-header__menu-toggle"
        @click="mobileMenuOpen = !mobileMenuOpen"
      />

      <div
        :id="menuId"
        class="site-header__panel"
        :class="{ 'is-open': mobileMenuOpen }"
      >
        <nav class="site-header__nav" :aria-label="t('public.home.publicNavigation')">
          <NuxtLink
            v-for="item in navigation"
            :key="item.to"
            :to="item.to"
            :aria-current="isActive(item.to) ? 'page' : undefined"
            class="site-header__nav-link"
            :class="{ 'is-active': isActive(item.to) }"
            @click="closeMobileMenu()"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>

        <div class="site-header__actions">
          <div class="site-header__utilities">
            <div class="site-header__language-dropdown">
              <UDropdownMenu
                :items="languageItems"
                :portal="false"
                :content="{ align: 'end' }"
                :ui="{ content: 'site-header__language-menu w-40', item: 'min-h-11 rounded-md text-sm' }"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  square
                  icon="i-mdi-translate"
                  :loading="isChangingLocale"
                  :disabled="isChangingLocale"
                  :aria-label="t('public.navigation.language')"
                  class="site-header__tool"
                />
              </UDropdownMenu>
            </div>

            <div
              class="site-header__languages"
              role="group"
              :aria-label="t('public.navigation.language')"
            >
              <UButton
                v-for="language in languages"
                :key="language.code"
                color="neutral"
                variant="ghost"
                size="sm"
                :disabled="isChangingLocale"
                :aria-pressed="locale === language.code"
                class="site-header__language"
                :class="{ 'is-active': locale === language.code }"
                @click="handleLocaleChange(language.code)"
              >
                {{ language.label }}
              </UButton>
            </div>

            <ClientOnly>
              <UColorModeButton
                color="neutral"
                variant="ghost"
                size="sm"
                square
                class="site-header__tool"
              />
              <template #fallback>
                <span class="site-header__tool-placeholder" aria-hidden="true" />
              </template>
            </ClientOnly>
          </div>

          <div class="site-header__account">
            <ClientOnly>
              <template v-if="user">
                <UButton
                  :to="dashboardPath"
                  size="sm"
                  class="site-header__account-button site-header__account-button--primary"
                  @click="closeMobileMenu()"
                >
                  {{ dashboardLabel }}
                </UButton>
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="site-header__account-button site-header__account-button--secondary"
                  @click="handleLogout"
                >
                  {{ t('public.home.logout') }}
                </UButton>
              </template>
              <template v-else>
                <UButton
                  to="/login"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="site-header__account-button site-header__account-button--secondary"
                  @click="closeMobileMenu()"
                >
                  {{ t('auth.login.title') }}
                </UButton>
                <UButton
                  v-if="registrationEnabled"
                  to="/register"
                  size="sm"
                  class="site-header__account-button site-header__account-button--primary"
                  @click="closeMobileMenu()"
                >
                  {{ t('auth.register.title') }}
                </UButton>
              </template>
              <template #fallback>
                <UButton
                  to="/login"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  class="site-header__account-button site-header__account-button--secondary"
                >
                  {{ t('auth.login.title') }}
                </UButton>
                <UButton
                  v-if="registrationEnabled"
                  to="/register"
                  size="sm"
                  class="site-header__account-button site-header__account-button--primary"
                >
                  {{ t('auth.register.title') }}
                </UButton>
              </template>
            </ClientOnly>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.site-header {
  position: sticky;
  top: 0;
  z-index: 40;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.site-header__inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  width: calc(100% - 32px);
  max-width: 1180px;
  min-height: 64px;
  margin-inline: auto;
  align-items: center;
  column-gap: 16px;
}

.site-header__brand {
  min-width: 0;
  min-height: 64px;
}

.site-header__brand :deep(.site-brand__mark) {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  box-shadow: none;
}

.site-header__brand :deep(.site-brand__copy) {
  min-width: 0;
}

.site-header__brand :deep(.site-brand__copy strong) {
  max-width: 100%;
  font-size: 16px;
  font-weight: 600;
  line-height: 20px;
  letter-spacing: -0.32px;
}

.site-header__panel {
  display: none;
  grid-column: 1 / -1;
  max-height: calc(100dvh - 65px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 4px 16px;
}

.site-header__panel.is-open {
  display: grid;
  gap: 16px;
}

.site-header__nav {
  display: grid;
  gap: 4px;
}

.site-header__nav-link {
  display: flex;
  min-width: 44px;
  min-height: 44px;
  align-items: center;
  padding: 8px 12px;
  border-radius: 999px;
  color: var(--ui-text-toned);
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
  transition: color 160ms ease, background-color 160ms ease;
}

.site-header__nav-link:hover,
.site-header__nav-link.is-active {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-muted);
}

.site-header__nav-link.is-active {
  font-weight: 500;
}

.site-header__actions {
  display: grid;
  gap: 16px;
}

.site-header__utilities {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-block: 8px;
  border-block: 1px solid var(--ui-border);
}

.site-header__tool,
.site-header__tool-placeholder {
  display: inline-flex;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
  align-items: center;
  justify-content: center;
}

.site-header__tool,
.site-header__language {
  padding: 0 6px;
  border: 0;
  border-radius: 6px;
  color: var(--ui-text-toned);
  background: transparent;
  box-shadow: none;
}

.site-header__tool:hover,
.site-header__tool[data-state="open"],
.site-header__language:hover,
.site-header__language.is-active {
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-muted);
}

.site-header__language-dropdown {
  display: none;
}

.site-header__languages {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px;
}

.site-header__language {
  min-width: 44px;
  min-height: 44px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}

.site-header__account {
  display: flex;
  gap: 8px;
}

.site-header__account-button {
  min-width: 44px;
  min-height: 44px;
  flex: 1;
  justify-content: center;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  box-shadow: none;
}

.site-header__account-button--secondary {
  border-color: var(--ui-border);
  color: var(--ui-text-highlighted);
  background: var(--ui-bg-elevated);
}

.site-header__account-button--secondary:hover {
  background: var(--ui-bg-muted);
}

.site-header__account-button--primary {
  border-color: var(--ui-primary);
  color: var(--ui-bg);
  background: var(--ui-primary);
}

.site-header__account-button--primary:hover {
  background: color-mix(in srgb, var(--ui-primary) 88%, var(--ui-bg));
}

.site-header :focus-visible {
  outline: 2px solid var(--ui-ring);
  outline-offset: 2px;
}

.site-header :deep(.site-header__language-menu) {
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  box-shadow: 0 2px 2px rgb(0 0 0 / 4%), 0 8px 16px -4px rgb(0 0 0 / 8%);
}

@media (min-width: 640px) {
  .site-header__inner { width: calc(100% - 48px); }
}

@media (min-width: 1024px) {
  .site-header__inner {
    display: flex;
    gap: 24px;
  }

  .site-header__brand {
    max-width: 176px;
    flex: 0 1 auto;
  }

  .site-header__menu-toggle { display: none; }

  .site-header__panel,
  .site-header__panel.is-open {
    display: contents;
  }

  .site-header__nav {
    display: flex;
    flex: 0 0 auto;
  }

  .site-header__actions {
    display: flex;
    flex: 0 0 auto;
    margin-inline-start: auto;
    align-items: center;
    gap: 12px;
  }

  .site-header__utilities {
    justify-content: start;
    gap: 4px;
    padding: 0 12px 0 0;
    border-block: 0;
    border-inline-end: 1px solid var(--ui-border);
  }

  .site-header__language-dropdown { display: block; }
  .site-header__languages { display: none; }

  .site-header__account-button { flex: 0 0 auto; }
}
</style>
