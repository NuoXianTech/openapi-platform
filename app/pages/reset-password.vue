<script setup lang="ts">
import type { ResetPasswordInput } from '#shared/types/auth'
import { parseFetchError } from '~/utils/client-error'
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import {
  compactFormErrors,
  confirmationError,
  passwordError
} from '~/utils/form-validation'

definePageMeta({ layout: false })

const { t } = useI18n()
const canAutofocus = useMediaQuery('(hover: hover) and (pointer: fine)')
const validationMessages = useAuthValidationMessages()
useHead(() => ({ title: t('auth.resetPassword.title') }))

const route = useRoute()
const toast = useToast()

const userId = computed(() => Number((route.query.user || '').toString()) || 0)
const token = computed(() => (route.query.token || '').toString())
const linkValid = computed(() => userId.value > 0 && token.value.length > 0)

interface ResetPasswordFormState {
  password: string
  confirm: string
}

function validateResetPasswordForm(state: Partial<ResetPasswordFormState>): FormError<string>[] {
  return compactFormErrors(
    passwordError('password', state.password, validationMessages.value.password),
    confirmationError(
      'confirm',
      state.confirm,
      state.password ?? '',
      validationMessages.value.confirmation
    )
  )
}

const authForm = ref<{ state: ResetPasswordFormState } | null>(null)
const passwordValue = computed(() => authForm.value?.state?.password ?? '')

const errorMessage = ref('')
const isSubmitting = ref(false)
const success = ref(false)

const fields = computed(() => [
  {
    name: 'password',
    type: 'password' as const,
    label: t('auth.resetPassword.newPassword'),
    placeholder: t('auth.resetPassword.newPasswordPlaceholder'),
    autocomplete: 'new-password',
    icon: 'i-mdi-lock-outline',
    defaultValue: '',
    size: 'lg' as const,
    required: true,
    autofocus: canAutofocus.value
  },
  {
    name: 'confirm',
    type: 'password' as const,
    label: t('auth.resetPassword.confirmNewPassword'),
    placeholder: t('auth.resetPassword.confirmNewPasswordPlaceholder'),
    autocomplete: 'new-password',
    icon: 'i-mdi-lock-check-outline',
    defaultValue: '',
    size: 'lg' as const,
    required: true
  }
])

async function onSubmit(event: FormSubmitEvent<ResetPasswordFormState>) {
  errorMessage.value = ''

  isSubmitting.value = true
  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: {
        userId: userId.value,
        token: token.value,
        newPassword: event.data.password
      } satisfies ResetPasswordInput
    })
    success.value = true
    toast.add({ title: t('auth.resetPassword.successToast'), color: 'success' })
    await new Promise(resolve => setTimeout(resolve, 800))
    await navigateTo('/login')
  } catch (error: unknown) {
    errorMessage.value = parseFetchError(error, t('auth.resetPassword.failed'))
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <CommonAppAuthShell>
    <AuthBrandHeader
      icon="i-mdi-lock-reset"
      :title="t('auth.resetPassword.title')"
      :subtitle="t('auth.resetPassword.subtitle')"
    />

    <UCard
      variant="outline"
      class="auth-card"
      :ui="{ body: 'p-4 sm:p-6' }"
    >
      <div
        v-if="!linkValid"
        class="space-y-4"
      >
        <div class="auth-message auth-message--error">
          <UIcon
            name="i-mdi-link-variant-off"
            class="auth-message__icon size-4"
          />
          <span>{{ $t('auth.resetPassword.invalidLink') }}</span>
        </div>
        <UButton
          to="/forgot-password"
          block
          size="lg"
          icon="i-lucide-refresh-cw"
        >
          {{ $t('auth.resetPassword.requestAgain') }}
        </UButton>
      </div>

      <div
        v-else-if="success"
        class="space-y-4 text-center"
      >
        <div class="auth-success-illustration">
          <UIcon
            name="i-mdi-check"
            class="size-11"
          />
        </div>
        <div>
          <h3 class="text-base font-semibold text-highlighted">
            {{ $t('auth.resetPassword.successTitle') }}
          </h3>
          <p class="text-sm text-muted mt-1.5">
            {{ $t('auth.resetPassword.successMessage') }}
          </p>
        </div>
      </div>

      <UAuthForm
        v-else
        ref="authForm"
        :validate="validateResetPasswordForm"
        :fields="fields"
        :loading="isSubmitting"
        :submit="{ label: t('auth.resetPassword.submit'), size: 'lg' }"
        @submit="onSubmit"
      >
        <template #password-help>
          <AuthPasswordStrength :password="passwordValue" />
        </template>

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
        </template>
      </UAuthForm>
    </UCard>

    <AuthFooterLinks
      :links="[
        { label: t('common.actions.backLogin'), to: '/login' },
        { label: t('common.actions.backHome'), to: '/' }
      ]"
    />
  </CommonAppAuthShell>
</template>
