<script setup lang="ts">
import type { AdminSettingsKey } from '~/composables/admin/use-admin-settings-page'
import { useAdminUserSessionSettings } from '~/composables/admin/use-admin-user-session-settings'

const {
  form,
  secrets,
  createSection,
  registrationModeItems,
  emailFilterModeItems,
  loading,
  items,
  getForm,
  isOauthDirty,
  isOauthReady,
  isOauthSaving,
  saveOauthSettings,
  copyCallback
} = useAdminUserSessionSettings()
const { t } = useI18n()

const registrationKeys = [
  'registrationMode',
  'registrationInviteCode',
  'passwordResetEnabled',
  'emailActivationEnabled',
  'registerEmailFilterMode',
  'registerEmailFilterList'
] as const satisfies readonly AdminSettingsKey[]

const sessionKeys = [
  'sessionMaxAgeSeconds',
  'sessionAbsoluteMaxAgeSeconds',
  'sessionRememberMaxAgeSeconds',
  'emailVerifyExpiresInMinutes',
  'passwordResetExpiresInMinutes'
] as const satisfies readonly AdminSettingsKey[]

const registrationSection = createSection(registrationKeys)
const sessionSection = createSection(sessionKeys)
const inviteCodeVisible = ref(false)
const inviteModeReady = computed(() => (
  form.registrationMode !== 'invite'
  || secrets.hasRegistrationInviteCode
  || form.registrationInviteCode.trim().length >= 8
))
</script>

<template>
  <div class="dashboard-settings-page">
    <DashboardSettingsSection
      :title="t('admin.system.session.registration.title')"
    >
      <UFormField
        name="registrationMode"
        :label="t('admin.system.session.registration.mode.label')"
        :description="t('admin.system.session.registration.mode.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <USelect
          v-model="form.registrationMode"
          :items="registrationModeItems"
          class="w-full sm:min-w-40"
        />
      </UFormField>
      <UFormField
        v-if="form.registrationMode === 'invite'"
        name="registrationInviteCode"
        :label="t('admin.system.session.registration.inviteCode.label')"
        :description="secrets.hasRegistrationInviteCode
          ? t('admin.system.session.registration.inviteCode.configuredDescription')
          : t('admin.system.session.registration.inviteCode.initialDescription')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
        :error="!inviteModeReady ? t('admin.system.session.registration.inviteCode.required') : undefined"
      >
        <UInput
          v-model="form.registrationInviteCode"
          :type="inviteCodeVisible ? 'text' : 'password'"
          :placeholder="t('admin.system.session.registration.inviteCode.placeholder')"
          icon="i-mdi-ticket-confirmation-outline"
          autocomplete="new-password"
          class="w-full sm:w-72"
          :ui="{ trailing: 'pe-1' }"
        >
          <template #trailing>
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="xs"
              square
              :icon="inviteCodeVisible ? 'i-mdi-eye-off-outline' : 'i-mdi-eye-outline'"
              :aria-label="inviteCodeVisible
                ? t('admin.system.session.registration.inviteCode.hide')
                : t('admin.system.session.registration.inviteCode.show')"
              @click="inviteCodeVisible = !inviteCodeVisible"
            />
          </template>
        </UInput>
      </UFormField>
      <UFormField
        name="passwordResetEnabled"
        :label="t('admin.system.session.registration.passwordReset.label')"
        :description="t('admin.system.session.registration.passwordReset.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <USwitch v-model="form.passwordResetEnabled" />
      </UFormField>
      <UFormField
        name="emailActivationEnabled"
        :label="t('admin.system.session.registration.emailActivation.label')"
        :description="t('admin.system.session.registration.emailActivation.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <USwitch v-model="form.emailActivationEnabled" />
      </UFormField>
      <UFormField
        name="registerEmailFilterMode"
        :label="t('admin.system.session.emailFilter.label')"
        :description="t('admin.system.session.emailFilter.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <USelect
          v-model="form.registerEmailFilterMode"
          :items="emailFilterModeItems"
          class="w-full sm:min-w-40"
        />
      </UFormField>
      <UFormField
        name="registerEmailFilterList"
        :label="t('admin.system.session.emailFilter.rulesLabel')"
        :description="form.registerEmailFilterMode === 'off'
          ? t('admin.system.session.emailFilter.disabledDescription')
          : t('admin.system.session.emailFilter.rulesDescription')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
        :ui="{ container: 'w-full sm:max-w-lg' }"
      >
        <UTextarea
          v-model="form.registerEmailFilterList"
          :rows="5"
          autoresize
          :disabled="form.registerEmailFilterMode === 'off'"
          placeholder="163.com, qq.com&#10;gmail.com"
          class="w-full"
        />
      </UFormField>
      <template #footer>
        <AdminSettingsSectionActions
          :dirty="registrationSection.dirty.value"
          :saving="registrationSection.saving.value"
          :disabled="registrationSection.disabled.value || !inviteModeReady"
          @save="registrationSection.save"
        />
      </template>
    </DashboardSettingsSection>

    <DashboardSettingsSection
      :title="t('admin.system.session.expiry.title')"
    >
      <UFormField
        name="sessionMaxAgeSeconds"
        :label="t('admin.system.session.expiry.defaultSession.label')"
        :description="t('admin.system.session.expiry.defaultSession.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <UInput
          v-model.number="form.sessionMaxAgeSeconds"
          type="number"
          :min="1"
          class="w-full sm:w-40"
        />
      </UFormField>
      <UFormField
        name="sessionAbsoluteMaxAgeSeconds"
        :label="t('admin.system.session.expiry.absoluteSession.label')"
        :description="t('admin.system.session.expiry.absoluteSession.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <UInput
          v-model.number="form.sessionAbsoluteMaxAgeSeconds"
          type="number"
          :min="1"
          class="w-full sm:w-40"
        />
      </UFormField>
      <UFormField
        name="sessionRememberMaxAgeSeconds"
        :label="t('admin.system.session.expiry.rememberSession.label')"
        :description="t('admin.system.session.expiry.rememberSession.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <UInput
          v-model.number="form.sessionRememberMaxAgeSeconds"
          type="number"
          :min="1"
          class="w-full sm:w-40"
        />
      </UFormField>
      <UFormField
        name="emailVerifyExpiresInMinutes"
        :label="t('admin.system.session.expiry.emailVerification.label')"
        :description="t('admin.system.session.expiry.emailVerification.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <UInput
          v-model.number="form.emailVerifyExpiresInMinutes"
          type="number"
          :min="1"
          class="w-full sm:w-40"
        />
      </UFormField>
      <UFormField
        name="passwordResetExpiresInMinutes"
        :label="t('admin.system.session.expiry.passwordReset.label')"
        :description="t('admin.system.session.expiry.passwordReset.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <UInput
          v-model.number="form.passwordResetExpiresInMinutes"
          type="number"
          :min="1"
          class="w-full sm:w-40"
        />
      </UFormField>
      <template #footer>
        <AdminSettingsSectionActions
          :dirty="sessionSection.dirty.value"
          :saving="sessionSection.saving.value"
          :disabled="sessionSection.disabled.value"
          @save="sessionSection.save"
        />
      </template>
    </DashboardSettingsSection>

    <DashboardSettingsSection
      :title="t('admin.system.session.oauth.title')"
    >
      <UFormField
        name="oauthForceBinding"
        :label="t('admin.system.session.oauth.forceBinding.label')"
        :description="t('admin.system.session.oauth.forceBinding.description')"
        class="flex max-sm:flex-col items-start justify-between gap-4"
      >
        <USwitch v-model="form.oauthForceBinding" />
      </UFormField>
      <USeparator />

      <div
        v-if="loading && items.length === 0"
        class="space-y-3"
      >
        <USkeleton
          v-for="i in 2"
          :key="i"
          class="h-16 w-full rounded-lg"
        />
      </div>
      <div
        v-else
        class="space-y-3"
      >
        <UCollapsible
          v-for="item in items"
          :key="item.provider"
          v-model:open="getForm(item.provider).open"
          :unmount-on-hide="false"
          class="dashboard-oauth-provider-card"
        >
          <button
            type="button"
            class="flex w-full items-center gap-3 p-4 text-left"
          >
            <UIcon
              :name="item.icon"
              class="text-2xl shrink-0"
            />
            <div class="flex flex-col min-w-0">
              <span class="font-medium truncate">{{ item.displayName }}</span>
              <span class="text-xs text-muted truncate">
                {{ t('admin.system.session.oauth.provider', { provider: item.provider }) }}
              </span>
            </div>
            <UBadge
              class="ml-auto shrink-0"
              :color="getForm(item.provider).isEnabled ? 'success' : 'neutral'"
              variant="subtle"
            >
              {{ getForm(item.provider).isEnabled
                ? t('admin.system.session.oauth.status.enabled')
                : t('admin.system.session.oauth.status.disabled') }}
            </UBadge>
            <UIcon
              name="i-mdi-chevron-down"
              class="size-5 shrink-0 text-muted transition-transform duration-200 motion-reduce:transition-none"
              :class="getForm(item.provider).open ? 'rotate-180' : ''"
            />
          </button>

          <template #content>
            <div class="dashboard-oauth-provider-divider border-t p-4 space-y-4">
              <UFormField :label="t('admin.system.session.oauth.clientId.label')">
                <UInput
                  v-model="getForm(item.provider).clientId"
                  :placeholder="t('admin.system.session.oauth.clientId.placeholder')"
                  icon="i-mdi-identifier"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                :label="t('admin.system.session.oauth.clientSecret.label')"
                :description="item.clientSecret
                  ? t('admin.system.session.oauth.clientSecret.savedDescription')
                  : t('admin.system.session.oauth.clientSecret.initialDescription')"
              >
                <UInput
                  v-model="getForm(item.provider).clientSecret"
                  :type="getForm(item.provider).secretVisible ? 'text' : 'password'"
                  placeholder="••••••••"
                  icon="i-mdi-key-variant"
                  class="w-full"
                  :ui="{ trailing: 'pe-1' }"
                >
                  <template #trailing>
                    <UButton
                      type="button"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      square
                      :icon="getForm(item.provider).secretVisible ? 'i-mdi-eye-off-outline' : 'i-mdi-eye-outline'"
                      :aria-label="getForm(item.provider).secretVisible
                        ? t('admin.system.session.oauth.clientSecret.hide')
                        : t('admin.system.session.oauth.clientSecret.show')"
                      @click="() => { getForm(item.provider).secretVisible = !getForm(item.provider).secretVisible }"
                    />
                  </template>
                </UInput>
              </UFormField>
              <UFormField
                :label="t('admin.system.session.oauth.callbackUrl.label')"
                :description="t('admin.system.session.oauth.callbackUrl.description')"
              >
                <div class="flex min-w-0 flex-col gap-2 sm:flex-row">
                  <UInput
                    :model-value="item.callbackUrl"
                    readonly
                    icon="i-mdi-link-variant"
                    class="min-w-0 flex-1"
                  />
                  <UButton
                    icon="i-mdi-content-copy"
                    color="neutral"
                    variant="outline"
                    @click="copyCallback(item)"
                  >
                    {{ t('common.actions.copy') }}
                  </UButton>
                </div>
              </UFormField>
              <UFormField
                :label="t('admin.system.session.oauth.scopes.label')"
                :description="t('admin.system.session.oauth.scopes.description')"
              >
                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="s in item.scopes"
                    :key="s"
                    variant="subtle"
                    color="neutral"
                  >
                    {{ s }}
                  </UBadge>
                  <span
                    v-if="!item.scopes.length"
                    class="text-xs text-muted"
                  >{{ t('admin.system.session.oauth.scopes.empty') }}</span>
                </div>
              </UFormField>

              <div class="dashboard-oauth-provider-divider flex items-center justify-between gap-2 pt-2 border-t">
                <USwitch
                  v-model="getForm(item.provider).isEnabled"
                  :label="t('admin.system.session.oauth.enableProvider')"
                />
              </div>
            </div>
          </template>
        </UCollapsible>
      </div>

      <template #footer>
        <AdminSettingsSectionActions
          :dirty="isOauthDirty"
          :saving="isOauthSaving"
          :disabled="!isOauthReady"
          @save="saveOauthSettings"
        />
      </template>
    </DashboardSettingsSection>
  </div>
</template>
