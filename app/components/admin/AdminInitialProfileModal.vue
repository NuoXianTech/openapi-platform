<script setup lang="ts">
import { useAdminInitialProfile } from '~/composables/admin/use-admin-initial-profile'
import { adminModalUi } from '~/utils/admin-modal-ui'

const {
  open,
  form,
  saving,
  errorMessage,
  canSubmit,
  submit
} = useAdminInitialProfile()
const { t } = useI18n()
</script>

<template>
  <UModal
    :open="open"
    :title="t('admin.initialProfile.title')"
    :description="t('admin.initialProfile.description')"
    :dismissible="false"
    :close="false"
    :ui="adminModalUi({ content: 'sm:max-w-md' })"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="submit"
      >
        <UFormField
          :label="t('auth.fields.username')"
          :help="t('admin.initialProfile.usernameHelp')"
        >
          <UInput
            v-model="form.username"
            class="w-full"
            icon="i-mdi-account-outline"
            :placeholder="t('auth.placeholders.username')"
            autocomplete="username"
          />
        </UFormField>

        <UFormField
          :label="t('auth.fields.email')"
          :help="t('admin.initialProfile.emailHelp')"
        >
          <UInput
            v-model="form.email"
            class="w-full"
            type="email"
            icon="i-mdi-email-outline"
            :placeholder="t('auth.placeholders.email')"
            autocomplete="email"
          />
        </UFormField>

        <UFormField
          :label="t('admin.initialProfile.newPassword')"
          required
          :help="t('admin.initialProfile.passwordHelp')"
        >
          <UInput
            v-model="form.password"
            class="w-full"
            type="password"
            icon="i-mdi-lock-outline"
            :placeholder="t('auth.placeholders.newPassword')"
            autocomplete="new-password"
            autofocus
          />
        </UFormField>

        <UFormField
          :label="t('auth.fields.confirmPassword')"
          required
        >
          <UInput
            v-model="form.confirmPassword"
            class="w-full"
            type="password"
            icon="i-mdi-lock-check-outline"
            :placeholder="t('auth.placeholders.confirmPassword')"
            autocomplete="new-password"
          />
        </UFormField>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="subtle"
          icon="i-mdi-alert-circle-outline"
          :title="errorMessage"
        />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="primary"
          icon="i-mdi-check"
          :loading="saving"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ t('common.actions.save') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
