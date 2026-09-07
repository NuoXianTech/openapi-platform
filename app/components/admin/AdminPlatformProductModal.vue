<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { PlatformProductSummary } from '#shared/types/platform'
import { adminModalUi } from '~/utils/admin-modal-ui'
import { parseFetchError } from '~/utils/client-error'
import { compactFormErrors, maxLengthError, requiredTextError } from '~/utils/form-validation'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  product: PlatformProductSummary
}>()
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()
const { t } = useI18n()

interface ProductFormState {
  name: string
  summary: string
  description: string
  visibility: 'public' | 'private'
  lifecycle: 'active' | 'deprecated' | 'retired'
}

function initialState(): ProductFormState {
  return {
    name: props.product.name,
    summary: props.product.summary,
    description: props.product.description,
    visibility: props.product.visibility,
    lifecycle: props.product.lifecycle
  }
}

const state = reactive<ProductFormState>(initialState())
const loading = ref(false)

const visibilityItems = computed(() => [
  { label: t('admin.apis.routing.visibility.public'), value: 'public' },
  { label: t('admin.apis.routing.visibility.private'), value: 'private' }
])
const lifecycleItems = computed(() => [
  { label: t('admin.apis.routing.lifecycle.active'), value: 'active' },
  { label: t('admin.apis.routing.lifecycle.deprecated'), value: 'deprecated' },
  { label: t('admin.apis.routing.lifecycle.retired'), value: 'retired' }
])

watch(open, (isOpen) => {
  if (isOpen) Object.assign(state, initialState())
})

function validateProductForm(value: Partial<ProductFormState>): FormError<string>[] {
  return compactFormErrors(
    requiredTextError('name', value.name, t('admin.apis.routing.validation.nameRequired')),
    maxLengthError('name', value.name, 160, t('admin.apis.routing.validation.nameMaxLength')),
    maxLengthError('summary', value.summary, 300, t('admin.apis.routing.validation.summaryMaxLength'))
  )
}

async function onSubmit(event: FormSubmitEvent<ProductFormState>) {
  loading.value = true
  try {
    await $fetch(
      `/api/admin/v1/products/${props.product.id}`,
      {
        method: 'PATCH',
        body: {
          name: event.data.name.trim(),
          summary: event.data.summary.trim(),
          description: event.data.description.trim(),
          visibility: event.data.visibility,
          lifecycle: event.data.lifecycle
        }
      }
    )
    toast.add({
      title: t('admin.apis.routing.feedback.productUpdated'),
      color: 'success'
    })
    open.value = false
    emit('saved')
  } catch (error: unknown) {
    toast.add({ title: parseFetchError(error, t('admin.apis.routing.feedback.updateFailed')), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('admin.apis.routing.productForm.editTitle')"
    :description="$t('admin.apis.routing.productForm.editDescription')"
    :dismissible="!loading"
    :ui="adminModalUi({ content: 'sm:max-w-2xl' })"
  >
    <template #body>
      <UForm
        id="platform-product-form"
        :state="state"
        :validate="validateProductForm"
        class="space-y-4"
        @submit="onSubmit"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            name="name"
            :label="$t('admin.apis.routing.fields.name')"
            required
          >
            <UInput
              v-model="state.name"
              :placeholder="$t('admin.apis.routing.productForm.namePlaceholder')"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="$t('admin.apis.routing.fields.slug')"
            :description="$t('admin.apis.routing.productForm.slugHelp')"
          >
            <UInput
              :model-value="product.slug"
              readonly
              class="w-full font-mono"
            />
          </UFormField>
        </div>
        <UFormField
          name="summary"
          :label="$t('admin.apis.routing.fields.summary')"
        >
          <UInput
            v-model="state.summary"
            :placeholder="$t('admin.apis.routing.productForm.summaryPlaceholder')"
            class="w-full"
          />
        </UFormField>
        <UFormField
          name="description"
          :label="$t('admin.apis.routing.fields.description')"
        >
          <UTextarea
            v-model="state.description"
            :rows="3"
            class="w-full"
          />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            name="visibility"
            :label="$t('admin.apis.routing.fields.visibility')"
          >
            <USelect
              v-model="state.visibility"
              :items="visibilityItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="lifecycle"
            :label="$t('admin.apis.routing.columns.lifecycle')"
          >
            <USelect
              v-model="state.lifecycle"
              :items="lifecycleItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </div>
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
          form="platform-product-form"
          :loading="loading"
        >
          {{ $t('common.actions.save') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
