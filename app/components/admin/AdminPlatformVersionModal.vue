<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { PlatformApiVersion, PlatformProduct } from '#shared/types/platform'
import { adminModalUi } from '~/utils/admin-modal-ui'
import type { VersionFormValues } from '~/composables/admin/use-admin-product-management'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  product: PlatformProduct
  version: PlatformApiVersion
  saving: boolean
  disabled: boolean
  save: (values: VersionFormValues) => Promise<boolean>
}>()
const { t } = useI18n()
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

async function submit(event: FormSubmitEvent<VersionFormValues>) {
  if (!props.disabled) await props.save(event.data)
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('admin.apis.routing.versionForm.editTitle')"
    :description="$t('admin.apis.routing.versionForm.description', { product: product.name })"
    :dismissible="!saving"
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
          :disabled="saving"
          @click="open = false"
        >
          {{ $t('common.actions.cancel') }}
        </UButton>
        <UButton
          type="submit"
          form="platform-version-form"
          :loading="saving"
          :disabled="disabled"
        >
          {{ $t('common.actions.save') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
