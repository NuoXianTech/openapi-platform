<script setup lang="ts">
import { useUserOauthSettings } from '~/composables/user/use-user-oauth-settings'

const route = useRoute()
const { locale } = useI18n()
const {
  oauthBindings,
  isOauthEnabled,
  isOauthLoading,
  loadOauthBindings,
  startOauthBinding,
  unbindOauthProvider,
  notifyOauthCallback
} = useUserOauthSettings()

onMounted(async () => {
  await loadOauthBindings()
  // 绑定回跳带回 oauth_bound / oauth_error，在此弹 toast 反馈
  notifyOauthCallback(route.query)
})
</script>

<template>
  <div class="space-y-8">
    <DashboardSettingsSection :title="$t('user.settings.oauth.title')">
      <template #actions>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-refresh-cw"
          :aria-label="$t('user.settings.oauth.refresh')"
          :loading="isOauthLoading"
          @click="loadOauthBindings"
        />
      </template>

      <div
        v-if="!isOauthEnabled && oauthBindings.length === 0"
        class="py-4 text-center text-sm text-muted"
      >
        {{ $t('user.settings.oauth.disabled') }}
      </div>
      <div
        v-else-if="oauthBindings.length === 0"
        class="py-4 text-center text-sm text-muted"
      >
        {{ $t('user.settings.oauth.empty') }}
      </div>
      <template v-else>
        <div
          v-for="binding in oauthBindings"
          :key="binding.provider"
          class="flex items-center justify-between gap-3"
        >
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated">
              <UIcon
                :name="binding.icon"
                class="size-6"
              />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium">
                  {{ binding.displayName }}
                </span>
                <UBadge
                  v-if="binding.bound"
                  color="success"
                  variant="subtle"
                  size="sm"
                >
                  {{ $t('user.settings.oauth.status.bound') }}
                </UBadge>
                <UBadge
                  v-else-if="binding.enabled"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                >
                  {{ $t('user.settings.oauth.status.unbound') }}
                </UBadge>
                <UBadge
                  v-else
                  color="warning"
                  variant="subtle"
                  size="sm"
                >
                  {{ $t('user.settings.oauth.status.disabled') }}
                </UBadge>
              </div>
              <div
                v-if="binding.bound"
                class="mt-0.5 truncate text-xs text-muted"
              >
                {{ binding.nickname || binding.providerUserId }}
                <span
                  v-if="binding.email"
                  class="ml-1"
                >· {{ binding.email }}</span>
                <span
                  v-if="binding.linkedAt"
                  class="ml-1"
                >· {{ $t('user.settings.oauth.linkedAt', { time: formatDateTime(binding.linkedAt, '-', locale) }) }}</span>
              </div>
            </div>
          </div>
          <div class="shrink-0">
            <UButton
              v-if="binding.bound"
              size="sm"
              color="error"
              variant="outline"
              @click="unbindOauthProvider(binding.provider)"
            >
              {{ $t('user.settings.oauth.actions.unbind') }}
            </UButton>
            <UButton
              v-else-if="binding.enabled"
              size="sm"
              variant="outline"
              @click="startOauthBinding(binding.provider)"
            >
              {{ $t('user.settings.oauth.actions.bind') }}
            </UButton>
          </div>
        </div>
      </template>
    </DashboardSettingsSection>
  </div>
</template>
