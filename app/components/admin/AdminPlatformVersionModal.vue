<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { PlatformApiVersion, PlatformProduct } from '#shared/types/platform'
import { adminModalUi } from '~/utils/admin-modal-ui'
import { parseFetchError } from '~/utils/client-error'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  product: PlatformProduct
  version: PlatformApiVersion
}>()
const emit = defineEmits<{ saved: [] }>()
const { t } = useI18n()
const toast = useToast()
const loading = ref(false)
const state = reactive({
  state: props.version.state,
  changelog: props.version.changelog
})

const stateItems = computed(() => [
  { label: t('admin.apis.routing.versionStates.draft'), value: 'draft' },
  { label: t('admin.apis.routing.versionStates.published'), value: 'published' },
  { label: t('admin.apis.routing.versionStates.deprecated'), value: 'deprecated' },
  { label: t('admin.apis.routing.versionStates.retired'), value: 'retired' }
])

watch(open, (value) => {
  if (!value) return
  Object.assign(state, {
    state: props.version.state,
    changelog: props.version.changelog
  })
})

async function submit(event: FormSubmitEvent<typeof state>) {
  loading.value = true
  try {
    await $fetch<PlatformApiVersion>(
      `/api/admin/v1/versions/${props.version.id}`,
      {
        method: 'PATCH',
        body: {
          state: event.data.state,
          changelog: event.data.changelog.trim()
        }
      }
    )
    toast.add({
      title: t('admin.apis.routing.feedback.versionUpdated'),
      color: 'success'
    })
    open.value = false
    emit('saved')
  } catch (error) {
    toast.add({ title: parseFetchError(error, t('common.feedback.operationFailed')), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('admin.apis.routing.versionForm.editTitle')"
    :description="$t('admin.apis.routing.versionForm.description', { product: product.name })"
    :dismissible="!loading"
    :ui="adminModalUi({ content: 'sm:max-w-xl' })"
  >
    <template #body>
      <UForm
        id="platform-version-form"
        :state="state"
        class="space-y-4"
        @submit="submit"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('admin.apis.routing.fields.version')" :description="$t('admin.apis.routing.versionForm.versionHelp')">
            <UInput :model-value="version.version" class="w-full font-mono" readonly />
          </UFormField>
          <UFormField name="state" :label="$t('admin.apis.routing.fields.versionState')">
            <USelect
              v-model="state.state"
              :items="stateItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField name="changelog" :label="$t('admin.apis.routing.fields.changelog')">
          <UTextarea v-model="state.changelog" :rows="4" class="w-full" />
        </UFormField>
      </UForm>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="loading"
          @click="open = false"
        >
          {{ $t('common.actions.cancel') }}
        </UButton>
        <UButton
          type="submit"
          form="platform-version-form"
          :loading="loading"
        >
          {{ $t('common.actions.save') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
