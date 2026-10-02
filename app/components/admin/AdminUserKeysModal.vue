<script setup lang="ts">
import type { AdminUserItem } from '~/composables/admin/use-admin-users-page'
import { adminModalUi } from '~/utils/admin-modal-ui'
import { useApiKeys } from '~/composables/api/use-api-keys'
import { useApiKeyDisplay } from '~/composables/api/use-api-key-display'

const props = defineProps<{
  open: boolean
  target: AdminUserItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const { locale } = useI18n()
const { getIpText, getQuotaText, getScopesText, getStatus } = useApiKeyDisplay()
const {
  items: keys, loading, scopeSelectItems, scopeLabelMap,
  form, formError, ipLineErrors, formOpen, editingId, submitting: creating,
  openCreate, openEdit: openEditForm, submitForm, openReset, toggleActive, remove: removeKeyAction
} = useApiKeys({ scope: 'admin', getUserId: () => props.target?.id, open: () => props.open })

function toggleForm() {
  if (formOpen.value) formOpen.value = false
  else void openCreate()
}
</script>

<template>
  <UModal
    :open="open"
    :title="$t('admin.users.apiKeys.title', { username: target?.username ?? '' })"
    :ui="adminModalUi({ content: 'sm:max-w-3xl' })"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="flex justify-end mb-3">
        <UButton
          size="sm"
          :icon="formOpen ? 'i-mdi-close' : 'i-mdi-plus'"
          :variant="formOpen ? 'outline' : 'solid'"
          @click="toggleForm"
        >
          {{ formOpen ? $t('admin.users.apiKeys.actions.collapse') : $t('admin.users.apiKeys.actions.add') }}
        </UButton>
      </div>

      <!-- 创建 / 编辑表单 · 折叠区 -->
      <div
        v-if="formOpen"
        class="rounded-lg border border-default p-3 mb-4 space-y-3"
      >
        <div
          v-if="editingId"
          class="text-xs text-muted"
        >
          {{ $t('admin.users.apiKeys.editingHint', { id: editingId }) }}
        </div>

        <ApiKeyFormFields
          v-model="form"
          :scope-select-items="scopeSelectItems"
          :ip-line-errors="ipLineErrors"
          :error="formError"
          :show-count="!editingId"
          :editing="!!editingId"
          size="sm"
        />

        <div class="flex justify-end gap-2">
          <UButton
            variant="outline"
            color="neutral"
            size="sm"
            @click="() => { formOpen = false }"
          >
            {{ $t('common.actions.cancel') }}
          </UButton>
          <UButton
            size="sm"
            :loading="creating"
            :disabled="!!formError"
            @click="submitForm"
          >
            {{ editingId ? $t('common.actions.save') : $t('admin.users.apiKeys.actions.generate') }}
          </UButton>
        </div>
      </div>

      <div
        v-if="loading"
        class="text-sm text-muted py-4 text-center"
      >
        {{ $t('common.states.loading') }}
      </div>
      <div
        v-else-if="keys.length === 0"
        class="text-sm text-muted py-4 text-center"
      >
        {{ $t('admin.users.apiKeys.empty') }}
      </div>
      <div
        v-else
        class="space-y-2"
      >
        <div
          v-for="key in keys"
          :key="key.id"
          class="rounded-lg border border-default p-3"
        >
          <div class="flex items-start justify-between gap-2 mb-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm font-medium">{{ key.name }}</span>
                <UBadge
                  v-if="getStatus(key).code !== 'enabled'"
                  :color="getStatus(key).color"
                  variant="subtle"
                  size="xs"
                >
                  {{ getStatus(key).label }}
                </UBadge>
              </div>
              <div class="flex items-center gap-1">
                <code class="font-mono text-xs px-2 py-1 rounded bg-elevated truncate">
                  {{ key.keyPreview }}
                </code>
              </div>
            </div>
            <div class="flex gap-1 shrink-0">
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                @click="openEditForm(key)"
              >
                {{ $t('common.actions.edit') }}
              </UButton>
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                @click="toggleActive(key)"
              >
                {{ key.isActive ? $t('common.apiKeys.actions.disable') : $t('common.apiKeys.actions.enable') }}
              </UButton>
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                @click="openReset(key)"
              >
                {{ $t('common.apiKeys.actions.reset') }}
              </UButton>
              <UButton
                size="xs"
                variant="outline"
                color="error"
                @click="removeKeyAction(key)"
              >
                {{ $t('common.actions.delete') }}
              </UButton>
            </div>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted">
            <div>{{ $t('admin.users.apiKeys.summary.expiry') }}：{{ formatDateTime(key.expiresAt, $t('common.apiKeys.expiry.never'), locale) }}</div>
            <div>{{ $t('admin.users.apiKeys.summary.quota') }}：{{ getQuotaText(key) }}</div>
            <div>{{ $t('admin.users.apiKeys.summary.scopes') }}：{{ getScopesText(key.scopes, scopeLabelMap) }}</div>
            <div>{{ $t('admin.users.apiKeys.summary.ip') }}：{{ getIpText(key.ipWhitelist) }}</div>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
