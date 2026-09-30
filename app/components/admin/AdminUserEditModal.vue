<script setup lang="ts">
import type { AdminUserItem } from '~/composables/admin/use-admin-users-page'
import { adminModalUi } from '~/utils/admin-modal-ui'

interface OAuthBinding {
  id: number
  provider: string
  providerUserId: string
  nickname: string | null
  email: string | null
  avatarUrl: string | null
  linkedAt: string
  lastLoginAt: string | null
}

const props = defineProps<{
  open: boolean
  target: AdminUserItem | null
  onSubmit: (id: number, payload: { email: string, displayName: string, role: 'user' | 'admin', isActive: boolean, password?: string }) => Promise<boolean>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
const { t, locale } = useI18n()

const form = reactive({ username: '', email: '', displayName: '', role: 'user' as 'user' | 'admin', isActive: false, password: '' })
const roleOptions = computed(() => [
  { label: t('common.identities.user'), value: 'user' },
  { label: t('common.identities.admin'), value: 'admin' }
])
const loading = ref(false)

const bindings = ref<OAuthBinding[]>([])
const bindingsLoading = ref(false)

watch(() => props.target, (val) => {
  if (!val) return
  Object.assign(form, {
    username: val.username || '',
    email: val.email || '',
    displayName: val.displayName || '',
    role: val.role || 'user',
    isActive: val.isActive ?? false
  })
}, { immediate: true })

watch(() => props.open, async (opened) => {
  if (!opened || !props.target) {
    bindings.value = []
    return
  }
  // 每次打开重置密码输入，避免上次输入残留（不回填现有密码）
  form.password = ''
  bindingsLoading.value = true
  try {
    const data = await $fetch<OAuthBinding[]>('/api/admin/users/oauth-accounts', {
      query: { userId: props.target.id }
    })
    bindings.value = data || []
  } catch {
    bindings.value = []
  } finally {
    bindingsLoading.value = false
  }
})

async function submit() {
  if (!props.target) return
  loading.value = true
  const ok = await props.onSubmit(props.target.id, {
    email: form.email,
    displayName: form.displayName,
    role: form.role,
    isActive: form.isActive,
    // 留空 = 不改密码（传 undefined，不进 body）
    password: form.password.trim() ? form.password : undefined
  })
  loading.value = false
  if (ok) emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    :title="$t('admin.users.edit.title')"
    :ui="adminModalUi()"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <form
        class="space-y-3"
        @submit.prevent="submit"
      >
        <UFormField
          :label="$t('admin.users.fields.username')"
          :help="$t('admin.users.edit.usernameHelp')"
        >
          <UInput
            v-model="form.username"
            disabled
          />
        </UFormField>
        <UFormField :label="$t('admin.users.fields.email')">
          <UInput
            v-model="form.email"
            type="email"
          />
        </UFormField>
        <UFormField :label="$t('admin.users.fields.displayName')">
          <UInput
            v-model="form.displayName"
            :maxlength="32"
          />
        </UFormField>
        <UFormField :label="$t('admin.users.fields.role')">
          <USelect
            v-model="form.role"
            :items="roleOptions"
            class="w-full"
          />
        </UFormField>
        <USwitch
          v-model="form.isActive"
          :label="$t('common.accounts.active')"
        />

        <UFormField
          :label="$t('admin.users.edit.resetPassword')"
          :help="$t('admin.users.edit.resetPasswordHelp')"
        >
          <UInput
            v-model="form.password"
            type="password"
            :placeholder="$t('admin.users.edit.passwordPlaceholder')"
            autocomplete="new-password"
          />
        </UFormField>

        <div class="pt-3 border-t border-default space-y-2">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-mdi-shield-key-outline"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">{{ $t('admin.users.edit.oauthBindings') }}</span>
            <span class="text-xs text-muted">{{ $t('admin.users.edit.readOnly') }}</span>
          </div>
          <div
            v-if="bindingsLoading"
            class="text-xs text-muted py-2"
          >
            {{ $t('common.states.loading') }}
          </div>
          <div
            v-else-if="bindings.length === 0"
            class="text-xs text-muted py-2"
          >
            {{ $t('admin.users.edit.noOauthBindings') }}
          </div>
          <div
            v-else
            class="space-y-1"
          >
            <div
              v-for="b in bindings"
              :key="b.id"
              class="flex items-center gap-2 text-xs py-1.5 px-2 rounded bg-elevated/50"
            >
              <UBadge
                variant="subtle"
                color="neutral"
              >
                {{ b.provider }}
              </UBadge>
              <span class="font-mono">{{ b.nickname || b.email || `#${b.providerUserId}` }}</span>
              <span class="ml-auto text-muted">
                {{ $t('admin.users.edit.lastLogin', { time: formatDateTime(b.lastLoginAt, '-', locale) }) }}
              </span>
            </div>
          </div>
        </div>
      </form>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          variant="outline"
          color="neutral"
          @click="emit('update:open', false)"
        >
          {{ $t('common.actions.cancel') }}
        </UButton>
        <UButton
          :loading="loading"
          @click="submit"
        >
          {{ $t('common.actions.save') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
