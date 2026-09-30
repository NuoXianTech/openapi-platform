<script setup lang="ts">
import type { ConfirmEmailChangeInput } from '#shared/types/auth'
import { parseFetchError } from '~/utils/client-error'

definePageMeta({ layout: false, appTheme: 'auth' })

const { t } = useI18n()
useHead(() => ({ title: t('auth.confirmEmailChange.title') }))

const route = useRoute()
const { fetchMe } = useAuth()

const userId = computed(() => Number((route.query.user || '').toString()) || 0)
const token = computed(() => (route.query.token || '').toString())
const linkValid = computed(() => userId.value > 0 && token.value.length > 0)

const status = ref<'idle' | 'submitting' | 'success' | 'error'>('idle')
const errorMessage = ref('')
const newEmail = ref('')

const headerSubtitle = computed(() => {
  if (status.value === 'success') {
    return t('auth.confirmEmailChange.successSubtitle')
  }
  if (status.value === 'error') {
    return t('auth.confirmEmailChange.errorSubtitle')
  }
  return t('auth.confirmEmailChange.idleSubtitle')
})

async function onConfirm() {
  if (status.value === 'submitting') return
  errorMessage.value = ''
  status.value = 'submitting'
  try {
    const result = await $fetch('/api/auth/confirm-email-change', {
      method: 'POST',
      body: {
        userId: userId.value,
        token: token.value
      } satisfies ConfirmEmailChangeInput
    })
    newEmail.value = result.email
    status.value = 'success'
    // 当前会话用户邮箱可能已变更，刷新登录态
    void fetchMe(true)
  } catch (error: unknown) {
    status.value = 'error'
    errorMessage.value = parseFetchError(error, t('auth.confirmEmailChange.failed'))
  }
}
</script>

<template>
  <CommonAppAuthShell>
    <AuthBrandHeader
      icon="i-mdi-email-sync-outline"
      :title="t('auth.confirmEmailChange.title')"
      :subtitle="headerSubtitle"
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
          <span>{{ $t('auth.confirmEmailChange.invalidLink') }}</span>
        </div>
        <UButton
          to="/user/settings"
          block
          size="lg"
          icon="i-mdi-account-cog-outline"
        >
          {{ $t('auth.confirmEmailChange.backSettings') }}
        </UButton>
      </div>

      <div
        v-else-if="status === 'success'"
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
            {{ $t('auth.confirmEmailChange.successTitle') }}
          </h3>
          <p class="text-sm text-muted mt-1.5">
            {{ $t('auth.confirmEmailChange.currentEmail', { email: newEmail }) }}
          </p>
        </div>
        <UButton
          to="/user/settings"
          block
          size="lg"
        >
          {{ $t('auth.confirmEmailChange.backSettings') }}
        </UButton>
      </div>

      <div
        v-else
        class="space-y-4"
      >
        <p class="text-sm text-muted">
          {{ $t('auth.confirmEmailChange.description') }}
        </p>
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
        <UButton
          :loading="status === 'submitting'"
          :disabled="status === 'submitting'"
          block
          size="lg"
          icon="i-mdi-email-check-outline"
          @click="onConfirm"
        >
          {{ $t('auth.confirmEmailChange.submit') }}
        </UButton>
      </div>
    </UCard>

    <AuthFooterLinks
      :links="[
        { label: t('common.actions.backLogin'), to: '/login' },
        { label: t('common.actions.backHome'), to: '/' }
      ]"
    />
  </CommonAppAuthShell>
</template>
