<script setup lang="ts">
import type { RequestPasswordResetInput } from '#shared/types/auth'
import { parseFetchError } from '~/utils/client-error'
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import { compactFormErrors, emailError } from '~/utils/form-validation'

definePageMeta({ layout: false })

const { t } = useI18n()
const canAutofocus = useMediaQuery('(hover: hover) and (pointer: fine)')
const validationMessages = useAuthValidationMessages()
useHead(() => ({ title: t('auth.forgotPassword.title') }))

const { turnstile, passwordResetEnabled } = useSiteSettings()

interface ForgotPasswordFormState {
  email: string
}

function validateForgotPasswordForm(state: Partial<ForgotPasswordFormState>): FormError<string>[] {
  return compactFormErrors(emailError('email', state.email, validationMessages.value.email))
}

const authForm = ref<{ state: ForgotPasswordFormState } | null>(null)

const errorMessage = ref('')
const turnstileError = ref('')
const submitted = ref(false)
const submittedEmail = ref('')
const isSubmitting = ref(false)
const turnstileToken = ref('')
const turnstileWidget = ref<{ reset: () => void } | null>(null)
const turnstileRequired = computed(() => turnstile.value.passwordReset)

const fields = computed(() => [
  {
    name: 'email',
    type: 'email' as const,
    label: t('auth.fields.email'),
    placeholder: t('auth.placeholders.email'),
    autocomplete: 'email',
    icon: 'i-mdi-email-outline',
    defaultValue: '',
    size: 'lg' as const,
    required: true,
    autofocus: canAutofocus.value
  }
])

const forgotPasswordErrorCodes = computed<Record<number, string>>(() => ({
  403: t('auth.forgotPassword.errors.disabled'),
  429: t('auth.forgotPassword.errors.tooManyRequests'),
  500: t('auth.forgotPassword.errors.server')
}))

const submitConfig = computed(() => ({
  label: t('auth.forgotPassword.submit'),
  size: 'lg' as const,
  disabled: turnstileRequired.value && !turnstileToken.value
}))

const footerLinks = computed(() => [
  { label: t('common.actions.backLogin'), to: '/login' },
  { label: t('common.actions.backHome'), to: '/' }
])

async function onSubmit(event: FormSubmitEvent<ForgotPasswordFormState>) {
  errorMessage.value = ''
  turnstileError.value = ''

  if (turnstileRequired.value && !turnstileToken.value) {
    errorMessage.value = t('auth.validation.turnstileRequired')
    return
  }

  isSubmitting.value = true
  try {
    await $fetch('/api/auth/request-password-reset', {
      method: 'POST',
      body: {
        email: event.data.email,
        turnstileToken: turnstileRequired.value ? turnstileToken.value : undefined
      } satisfies RequestPasswordResetInput
    })
    submittedEmail.value = event.data.email
    submitted.value = true
  } catch (error: unknown) {
    errorMessage.value = parseFetchError(error, t('auth.forgotPassword.submitFailed'), forgotPasswordErrorCodes.value)
    turnstileWidget.value?.reset()
  } finally {
    isSubmitting.value = false
  }
}

function onTurnstileError(message: string) {
  turnstileError.value = message
}

function clearTurnstileError() {
  turnstileError.value = ''
}
</script>

<template>
  <CommonAppAuthShell>
    <AuthBrandHeader
      icon="i-mdi-lock-reset"
      :title="t('auth.forgotPassword.title')"
      :subtitle="t('auth.forgotPassword.subtitle')"
    />

    <UCard
      variant="outline"
      class="auth-card"
      :ui="{ body: 'p-4 sm:p-6' }"
    >
      <div
        v-if="!passwordResetEnabled"
        class="space-y-4"
      >
        <div class="auth-message auth-message--error">
          <UIcon
            name="i-mdi-alert-circle-outline"
            class="auth-message__icon size-4"
          />
          <span>{{ $t('auth.forgotPassword.disabled') }}</span>
        </div>
        <UButton
          to="/login"
          variant="outline"
          color="neutral"
          block
          size="lg"
          icon="i-mdi-arrow-left"
        >
          {{ $t('common.actions.backLogin') }}
        </UButton>
      </div>

      <div
        v-else-if="submitted"
        class="space-y-4 text-center"
      >
        <div class="auth-success-illustration">
          <UIcon
            name="i-mdi-email-fast-outline"
            class="size-11"
          />
        </div>
        <div>
          <h3 class="text-base font-semibold text-highlighted">
            {{ $t('auth.forgotPassword.sentTitle') }}
          </h3>
          <p class="text-sm text-muted mt-1.5 leading-relaxed">
            {{ $t('auth.forgotPassword.sentMessage', { email: submittedEmail }) }}
          </p>
        </div>
        <UButton
          to="/login"
          block
          size="lg"
          icon="i-mdi-arrow-left"
        >
          {{ $t('common.actions.backLogin') }}
        </UButton>
      </div>

      <UAuthForm
        v-else
        ref="authForm"
        :validate="validateForgotPasswordForm"
        :fields="fields"
        :loading="isSubmitting"
        :submit="submitConfig"
        @submit="onSubmit"
      >
        <template #validation>
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
      :links="footerLinks"
    />
  </CommonAppAuthShell>
</template>
