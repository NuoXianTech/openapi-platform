<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import { parseFetchError } from '~/utils/client-error'
import { ADMIN_OVERVIEW_PATH, USER_OVERVIEW_PATH } from '~/constants/dashboard-config'
import { compactFormErrors, requiredTextError } from '~/utils/form-validation'

definePageMeta({ layout: false })

const { t } = useI18n()
useHead(() => ({ title: t('auth.login.title') }))

const { fetchMe, user, login } = useAuth()
const { turnstile, registrationEnabled, passwordResetEnabled, settings } = useSiteSettings()
const route = useRoute()
const canAutofocus = useMediaQuery('(hover: hover) and (pointer: fine)')

interface LoginFormState {
  identifier: string
  password: string
}

function validateLoginForm(state: Partial<LoginFormState>): FormError<string>[] {
  return compactFormErrors(
    requiredTextError('identifier', state.identifier, t('auth.validation.identifierRequired')),
    requiredTextError('password', state.password, t('auth.validation.passwordRequired'))
  )
}

const errorMessage = ref('')
const turnstileError = ref('')
const isSubmitting = ref(false)
const checkingAuth = ref(true)
const turnstileToken = ref('')
const turnstileWidget = ref<{ reset: () => void } | null>(null)
const turnstileRequired = computed(() => turnstile.value.login)
const remember = ref(false)

// 配置了服务条款 / 隐私政策时，登录前必须勾选同意
const consent = ref(false)
const consentRequired = computed(() => Boolean(settings.value.termsUrl || settings.value.privacyUrl))

const { data: providersData } = useLazyFetch<Array<{ provider: string, displayName: string, icon: string | null, authorizeEntry: string }>>('/api/auth/providers/list', {
  default: () => []
})

const providers = computed(() => (providersData.value || []).map(p => ({
  label: t('auth.login.oauthButton', { provider: p.displayName }),
  icon: p.icon || 'i-mdi-account-circle-outline',
  color: 'neutral' as const,
  variant: 'outline' as const,
  size: 'lg' as const,
  onClick: () => gotoOAuth(p.authorizeEntry)
})))

const fields = computed(() => [
  {
    name: 'identifier',
    type: 'text' as const,
    label: t('auth.fields.identifier'),
    placeholder: t('auth.placeholders.identifier'),
    autocomplete: 'username',
    icon: 'i-mdi-account-outline',
    defaultValue: '',
    size: 'lg' as const,
    required: true,
    autofocus: canAutofocus.value
  },
  {
    name: 'password',
    type: 'password' as const,
    label: t('auth.fields.password'),
    placeholder: t('auth.placeholders.loginPassword'),
    autocomplete: 'current-password',
    icon: 'i-mdi-lock-outline',
    defaultValue: '',
    size: 'lg' as const,
    required: true
  }
])

const oauthError = computed(() => {
  const code = (route.query.oauth_error || '').toString()
  if (!code) {
    return ''
  }
  const map: Record<string, string> = {
    state_mismatch: t('auth.login.errors.stateMismatch'),
    missing_code: t('auth.login.errors.missingCode'),
    provider_unavailable: t('auth.login.errors.providerUnavailable'),
    provider_not_supported: t('auth.login.errors.providerNotSupported'),
    provider_not_implemented: t('auth.login.errors.providerNotImplemented'),
    oauth_disabled: t('auth.login.errors.oauthDisabled'),
    account_inactive: t('auth.login.errors.accountInactive'),
    user_banned: t('auth.login.errors.userBanned'),
    user_unavailable: t('auth.login.errors.userUnavailable'),
    callback_failed: t('auth.login.errors.callbackFailed')
  }
  return map[code] || t('auth.login.failedWithCode', { code })
})

const loginErrorCodes = computed<Record<number, string>>(() => ({
  401: t('auth.login.errors.unauthorized'),
  403: t('auth.login.errors.forbidden'),
  429: t('auth.login.errors.tooManyRequests'),
  500: t('auth.login.errors.server')
}))

const submitConfig = computed(() => ({
  label: t('auth.login.submit'),
  size: 'lg' as const,
  disabled: (turnstileRequired.value && !turnstileToken.value) || (consentRequired.value && !consent.value)
}))

const footerLinks = computed(() => [
  ...(registrationEnabled.value
    ? [{ label: t('auth.login.createAccount'), to: '/register' }]
    : []),
  { label: t('common.actions.backHome'), to: '/' }
])

onMounted(async () => {
  await fetchMe()
  if (user.value) {
    await navigateTo(user.value.role === 'admin' ? ADMIN_OVERVIEW_PATH : USER_OVERVIEW_PATH)
    return
  }
  checkingAuth.value = false
})

async function onSubmit(event: FormSubmitEvent<LoginFormState>) {
  errorMessage.value = ''
  turnstileError.value = ''

  if (consentRequired.value && !consent.value) {
    errorMessage.value = t('auth.validation.consentRequired')
    return
  }

  if (turnstileRequired.value && !turnstileToken.value) {
    errorMessage.value = t('auth.validation.turnstileRequired')
    return
  }

  isSubmitting.value = true
  try {
    const base = event.data.identifier.includes('@')
      ? { email: event.data.identifier, password: event.data.password }
      : { username: event.data.identifier, password: event.data.password }
    const withRemember = { ...base, remember: remember.value }
    const payload = turnstileRequired.value
      ? { ...withRemember, turnstileToken: turnstileToken.value }
      : withRemember

    const authUser = await login(payload)
    await navigateTo(authUser.role === 'admin' ? ADMIN_OVERVIEW_PATH : USER_OVERVIEW_PATH)
  } catch (error: unknown) {
    errorMessage.value = parseFetchError(error, t('auth.login.failed'), loginErrorCodes.value)
    turnstileWidget.value?.reset()
  } finally {
    isSubmitting.value = false
  }
}

function gotoOAuth(entry: string) {
  const returnTo = encodeURIComponent(window.location.pathname + window.location.search)
  window.location.href = `${entry}?returnTo=${returnTo}`
}

function onTurnstileError(message: string) {
  turnstileError.value = message
}

function clearTurnstileError() {
  turnstileError.value = ''
}
</script>

<template>
  <CommonAppAuthShell :show-brand="false">
    <AuthBrandHeader
      :title="t('auth.login.welcome', { siteName: settings.siteName })"
    />

    <UCard
      variant="outline"
      class="auth-card"
      :ui="{ body: 'p-4 sm:p-6' }"
    >
      <div
        v-if="checkingAuth"
        class="space-y-4"
        aria-hidden="true"
      >
        <div class="space-y-2">
          <USkeleton class="h-4 w-24 rounded" />
          <USkeleton class="auth-control-skeleton w-full rounded-md" />
        </div>
        <div class="space-y-2">
          <USkeleton class="h-4 w-20 rounded" />
          <USkeleton class="auth-control-skeleton w-full rounded-md" />
        </div>
        <USkeleton class="h-5 w-32 rounded" />
        <USkeleton class="auth-control-skeleton w-full rounded-md" />
      </div>

      <UAuthForm
        v-else
        :validate="validateLoginForm"
        :fields="fields"
        :providers="providers"
        :loading="isSubmitting"
        :submit="submitConfig"
        :separator="t('auth.login.oauthSeparator')"
        @submit="onSubmit"
      >
        <template #password-hint>
          <UButton
            v-if="passwordResetEnabled"
            type="button"
            variant="link"
            size="xs"
            to="/forgot-password"
            class="auth-text-button text-muted px-0"
          >
            {{ $t('auth.login.forgotPassword') }}
          </UButton>
        </template>

        <template #validation>
          <div class="auth-form-options">
            <UCheckbox
              v-model="remember"
              :label="t('auth.login.rememberMe')"
              size="md"
            />

            <AuthConsent
              v-if="consentRequired"
              v-model="consent"
            />
          </div>

          <Transition name="state-fade">
            <div
              v-if="errorMessage"
              class="auth-message auth-message--error"
            >
              <UIcon
                name="i-mdi-alert-circle-outline"
                class="auth-message__icon size-4"
              />
              <span>{{ errorMessage }}</span>
            </div>
          </Transition>

          <Transition name="state-fade">
            <div
              v-if="oauthError"
              class="auth-message auth-message--error"
            >
              <UIcon
                name="i-mdi-alert-circle-outline"
                class="auth-message__icon size-4"
              />
              <span>{{ oauthError }}</span>
            </div>
          </Transition>

          <Transition name="state-fade">
            <div
              v-if="turnstileError"
              class="auth-message auth-message--error"
            >
              <UIcon
                name="i-mdi-alert-circle-outline"
                class="auth-message__icon size-4"
              />
              <span>{{ turnstileError }}</span>
            </div>
          </Transition>

          <CommonTurnstileWidget
            v-if="turnstileRequired"
            ref="turnstileWidget"
            v-model:token="turnstileToken"
            :site-key="turnstile.siteKey"
            @verified="clearTurnstileError"
            @expired="clearTurnstileError"
            @error="onTurnstileError"
          />
        </template>
      </UAuthForm>
    </UCard>

    <AuthFooterLinks
      :prefix="t('auth.login.noAccount')"
      :links="footerLinks"
    />
  </CommonAppAuthShell>
</template>
