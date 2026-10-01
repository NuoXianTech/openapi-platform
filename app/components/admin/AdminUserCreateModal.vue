<script setup lang="ts">
import { adminModalUi } from '~/utils/admin-modal-ui'

const props = defineProps<{
  open: boolean
  onSubmit: (payload: { username: string, email: string, password: string, displayName: string, role: 'user' | 'admin', isActive: boolean }) => Promise<boolean>
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()
const { t } = useI18n()

const form = reactive({
  username: '',
  email: '',
  password: '',
  displayName: '',
  role: 'user' as 'user' | 'admin',
  isActive: true
})
const roleOptions = computed(() => [
  { label: t('common.identities.user'), value: 'user' },
  { label: t('common.identities.admin'), value: 'admin' }
])
const loading = ref(false)

function resetForm() {
  form.username = ''
  form.email = ''
  form.password = ''
  form.displayName = ''
  form.role = 'user'
  form.isActive = true
}

watch(() => props.open, (opened) => {
  if (opened) resetForm()
})

async function submit() {
  loading.value = true
  const ok = await props.onSubmit({ ...form })
  loading.value = false
  if (ok) emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    :title="$t('admin.users.create.title')"
    :description="$t('admin.users.create.description')"
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
          required
          :help="$t('admin.users.create.usernameHelp')"
        >
          <UInput
            v-model="form.username"
            class="w-full"
            :placeholder="$t('admin.users.create.usernamePlaceholder')"
            autocomplete="off"
          />
        </UFormField>
        <UFormField
          :label="$t('admin.users.fields.email')"
          required
        >
          <UInput
            v-model="form.email"
            class="w-full"
            type="email"
            :placeholder="t('admin.users.create.emailPlaceholder')"
            autocomplete="off"
          />
        </UFormField>
        <UFormField
          :label="$t('admin.users.create.initialPassword')"
          required
          :help="$t('admin.users.create.passwordHelp')"
        >
          <UInput
            v-model="form.password"
            class="w-full"
            type="password"
            :placeholder="$t('admin.users.create.passwordHelp')"
            autocomplete="new-password"
          />
        </UFormField>
        <UFormField
          :label="$t('admin.users.create.displayName')"
          :help="$t('admin.users.create.displayNameHelp')"
        >
          <UInput
            v-model="form.displayName"
            class="w-full"
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
          :label="$t('admin.users.create.activateImmediately')"
        />
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
          {{ $t('common.actions.create') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
