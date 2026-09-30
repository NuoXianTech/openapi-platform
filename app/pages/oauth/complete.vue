<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import type { OauthRegisterInput } from '#shared/types/auth'
import type { PendingOauthView } from '#shared/types/oauth'
import { parseFetchError } from '~/utils/client-error'
import { USER_OVERVIEW_PATH } from '~/constants/dashboard-config'
import {
  compactFormErrors,
  confirmationError,
  emailError,
  passwordError,
  requiredTextError,
  usernameError
} from '~/utils/form-validation'

definePageMeta({ layout: false })
const { t } = useI18n()
const validationMessages = useAuthValidationMessages()
useHead(() => ({ title: t('auth.oauthComplete.title') }))

interface OauthBindFormState {
  identifier: string
  password: string
}

interface OauthRegisterFormState {
  email: string
  username: string
  inviteCode: string
  password: string
  confirmPassword: string
}

const toast = useToast()

const loading = ref(true)
const info = ref<PendingOauthView | null>(null)
const mode = ref<'bind' | 'register'>('bind')
const submitting = ref(false)

const bindState = reactive<OauthBindFormState>({ identifier: '', password: '' })
const registerState = reactive<OauthRegisterFormState>({ email: '', username: '', inviteCode: '', password: '', confirmPassword: '' })

// 注册成功且需邮箱激活后，切换到「去邮箱激活」提示面板
const emailSent = ref(false)
const sentToEmail = ref('')

const ready = computed(() => Boolean(info.value?.pending))
const allowRegister = computed(() => Boolean(info.value?.allowRegister))

function validateBindForm(state: Partial<OauthBindFormState>): FormError<string>[] {
  return compactFormErrors(
    requiredTextError('identifier', state.identifier, t('auth.validation.identifierRequired')),
    requiredTextError('password', state.password, t('auth.validation.passwordRequired'))
  )
}

function validateRegisterForm(state: Partial<OauthRegisterFormState>): FormError<string>[] {
  return compactFormErrors(
    emailError('email', state.email, validationMessages.value.email),
    usernameError('username', state.username, validationMessages.value.username, false),
    info.value?.requiresInviteCode
      ? requiredTextError('inviteCode', state.inviteCode, t('auth.validation.inviteCodeRequired'))
      : null,
    passwordError('password', state.password, validationMessages.value.password),
    confirmationError(
      'confirmPassword',
      state.confirmPassword,
      state.password ?? '',
      validationMessages.value.confirmation
    )
  )
}

onMounted(async () => {
  try {
    const data = await $fetch<PendingOauthView>('/api/auth/oauth/pending')
    info.value = data
    if (data.pending) {
      registerState.email = data.email || ''
      registerState.username = data.suggestedUsername || ''
    }
  } catch {
    info.value = { pending: false }
  } finally {
    loading.value = false
  }
})

async function submitBind() {
  submitting.value = true
  try {
    await $fetch('/api/auth/oauth/bind', {
      method: 'POST',
      body: { identifier: bindState.identifier, password: bindState.password }
    })
    await navigateTo(USER_OVERVIEW_PATH)
  } catch (error: unknown) {
    toast.add({ title: parseFetchError(error, t('auth.oauthComplete.bindFailed')), color: 'error' })
  } finally {
    submitting.value = false
  }
}

async function submitRegister() {
  submitting.value = true
  try {
    const res = await $fetch('/api/auth/oauth/register', {
      method: 'POST',
      body: {
        email: registerState.email,
        username: registerState.username || undefined,
        password: registerState.password,
        inviteCode: info.value?.requiresInviteCode
          ? registerState.inviteCode
          : undefined
      } satisfies OauthRegisterInput
    })
    if (res.verificationRequired) {
      // 账号已创建并绑定该第三方身份，待邮箱激活；激活链接由 verify-email 自动登录后进用户中心
      sentToEmail.value = registerState.email
      emailSent.value = true
    } else {
      toast.add({ title: t('auth.oauthComplete.registerSuccess'), color: 'success' })
      await navigateTo(USER_OVERVIEW_PATH)
    }
  } catch (error: unknown) {
    toast.add({ title: parseFetchError(error, t('auth.oauthComplete.registerFailed')), color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <CommonAppAuthShell>
    <AuthBrandHeader
      icon="i-mdi-link-variant"
      :title="t('auth.oauthComplete.title')"
      :subtitle="t('auth.oauthComplete.subtitle')"
    />

    <UCard
      variant="outline"
      class="auth-card"
      :ui="{ body: 'p-4 sm:p-6' }"
    >
      <!-- 加载中 -->
      <div
        v-if="loading"
        class="space-y-3"
      >
        <USkeleton class="h-16 w-full rounded-lg" />
        <USkeleton class="h-11 w-full rounded-lg" />
        <USkeleton class="h-11 w-full rounded-lg" />
      </div>

      <!-- 会话失效 / 无待处理身份 -->
      <div
        v-else-if="!ready"
        class="space-y-4 text-center"
      >
        <UIcon
          name="i-mdi-timer-sand-empty"
          class="mx-auto size-10 text-muted"
        />
        <p class="text-sm text-muted">
          {{ $t('auth.oauthComplete.expired') }}
        </p>
        <UButton
          block
          size="lg"
          to="/login"
        >
          {{ $t('common.actions.backLogin') }}
        </UButton>
      </div>

      <!-- 新注册成功 → 去邮箱激活提示 -->
      <div
        v-else-if="emailSent"
        class="space-y-4 text-center"
      >
        <div class="auth-success-illustration">
          <UIcon
            name="i-mdi-email-fast-outline"
            class="size-11"
          />
        </div>
        <div class="space-y-1">
          <p class="font-medium">
            {{ $t('auth.oauthComplete.emailSentTitle') }}
          </p>
          <p class="text-sm text-muted">
            {{ $t('auth.oauthComplete.emailSentMessage', { email: sentToEmail }) }}
          </p>
        </div>
        <UButton
          block
          size="lg"
          variant="outline"
          color="neutral"
          to="/login"
        >
          {{ $t('common.actions.backLogin') }}
        </UButton>
      </div>

      <!-- 待处理身份 -->
      <div
        v-else
        class="space-y-5"
      >
        <!-- 三方身份卡 -->
        <div class="flex items-center gap-3 rounded-lg border border-default bg-elevated/40 p-3">
          <UAvatar
            :src="info?.avatarUrl || undefined"
            :icon="info?.icon || 'i-mdi-account-circle-outline'"
            size="lg"
          />
          <div class="min-w-0">
            <p class="truncate font-medium">
              {{ info?.nickname || info?.displayName }}
            </p>
            <p class="truncate text-xs text-muted">
              {{ $t('auth.oauthComplete.providerSource', { provider: info?.displayName }) }}{{ info?.email ? ` · ${info?.email}` : '' }}
            </p>
          </div>
        </div>

        <UAlert
          v-if="info?.emailHasAccount"
          color="info"
          variant="subtle"
          icon="i-mdi-information-outline"
          :title="t('auth.oauthComplete.existingEmailTitle')"
          :description="t('auth.oauthComplete.existingEmailDescription')"
        />

        <!-- 模式切换（仅在允许新注册时显示） -->
        <div
          v-if="allowRegister"
          class="grid grid-cols-2 gap-2"
        >
          <UButton
            :variant="mode === 'bind' ? 'solid' : 'outline'"
            :color="mode === 'bind' ? 'primary' : 'neutral'"
            block
            @click="() => { mode = 'bind' }"
          >
            {{ $t('auth.oauthComplete.bindMode') }}
          </UButton>
          <UButton
            :variant="mode === 'register' ? 'solid' : 'outline'"
            :color="mode === 'register' ? 'primary' : 'neutral'"
            block
            @click="() => { mode = 'register' }"
          >
            {{ $t('auth.oauthComplete.registerMode') }}
          </UButton>
        </div>

        <!-- 绑定已有账号 -->
        <UForm
          v-if="mode === 'bind'"
          :validate="validateBindForm"
          :state="bindState"
          class="space-y-4"
          @submit="submitBind"
        >
          <UFormField
            name="identifier"
            :label="t('auth.fields.identifier')"
          >
            <UInput
              v-model="bindState.identifier"
              :placeholder="t('auth.placeholders.email')"
              icon="i-mdi-account-outline"
              size="lg"
              autocomplete="username"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="password"
            :label="t('auth.fields.password')"
          >
            <UInput
              v-model="bindState.password"
              type="password"
              :placeholder="t('auth.placeholders.loginPassword')"
              icon="i-mdi-lock-outline"
              size="lg"
              autocomplete="current-password"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="submit"
            block
            size="lg"
            :loading="submitting"
          >
            {{ $t('auth.oauthComplete.bindSubmit') }}
          </UButton>
        </UForm>

        <!-- 新注册 -->
        <UForm
          v-else
          :validate="validateRegisterForm"
          :state="registerState"
          class="space-y-4"
          @submit="submitRegister"
        >
          <UFormField
            name="email"
            :label="t('auth.fields.email')"
            :description="info?.email ? t('auth.oauthComplete.emailPrefilled') : t('auth.oauthComplete.emailRequired')"
          >
            <UInput
              v-model="registerState.email"
              type="email"
              :placeholder="t('auth.placeholders.email')"
              icon="i-mdi-email-outline"
              size="lg"
              autocomplete="email"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="username"
            :label="t('auth.fields.username')"
            :description="t('auth.oauthComplete.usernameDescription')"
          >
            <UInput
              v-model="registerState.username"
              :placeholder="t('auth.oauthComplete.usernamePlaceholder')"
              icon="i-mdi-account-outline"
              size="lg"
              class="w-full"
            />
          </UFormField>
          <UFormField
            v-if="info?.requiresInviteCode"
            name="inviteCode"
            :label="t('auth.fields.inviteCode')"
          >
            <UInput
              v-model="registerState.inviteCode"
              :placeholder="t('auth.placeholders.inviteCode')"
              icon="i-mdi-ticket-confirmation-outline"
              size="lg"
              autocomplete="one-time-code"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="password"
            :label="t('auth.fields.password')"
          >
            <UInput
              v-model="registerState.password"
              type="password"
              :placeholder="t('auth.placeholders.newPassword')"
              icon="i-mdi-lock-outline"
              size="lg"
              autocomplete="new-password"
              class="w-full"
            />
            <AuthPasswordStrength :password="registerState.password" />
          </UFormField>
          <UFormField
            name="confirmPassword"
            :label="t('auth.fields.confirmPassword')"
          >
            <UInput
              v-model="registerState.confirmPassword"
              type="password"
              :placeholder="t('auth.placeholders.confirmPassword')"
              icon="i-mdi-lock-check-outline"
              size="lg"
              autocomplete="new-password"
              class="w-full"
            />
          </UFormField>
          <UButton
            type="submit"
            block
            size="lg"
            :loading="submitting"
          >
            {{ $t('auth.register.submit') }}
          </UButton>
        </UForm>
      </div>
    </UCard>

    <AuthFooterLinks
      :prefix="t('auth.oauthComplete.notYou')"
      :links="[
        { label: t('common.actions.backLogin'), to: '/login' },
        { label: t('common.actions.backHome'), to: '/' }
      ]"
    />
  </CommonAppAuthShell>
</template>
