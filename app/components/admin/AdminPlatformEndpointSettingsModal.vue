<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { PlatformEndpointPublicationResult, PlatformRouteBinding } from '#shared/types/platform'
import { adminModalUi } from '~/utils/admin-modal-ui'
import { parseFetchError } from '~/utils/client-error'
import { compactFormErrors, integerRangeError, maxLengthError, requiredTextError } from '~/utils/form-validation'
import {
  createEndpointSettingsForm,
  endpointSettingsPayload,
  type EndpointSettingsForm
} from '~/utils/platform-endpoint-settings'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  routeBinding: PlatformRouteBinding
}>()
const emit = defineEmits<{ saved: [result: PlatformEndpointPublicationResult] }>()
const { t } = useI18n()

const state = reactive<EndpointSettingsForm>(createEndpointSettingsForm(props.routeBinding.route))
const loading = ref(false)
const error = ref<string | null>(null)
const advancedOpen = ref(true)
const catalogStatusItems = computed(() => [
  { label: t('admin.apis.routing.catalogStatuses.automatic'), value: 'automatic' },
  { label: t('admin.apis.routing.catalogStatuses.maintenance'), value: 'maintenance' }
])

watch(open, (isOpen) => {
  if (isOpen) {
    Object.assign(state, createEndpointSettingsForm(props.routeBinding.route))
    advancedOpen.value = true
    error.value = null
  }
})

watch(() => state.creditsCost, (creditsCost) => {
  if (creditsCost > 0) {
    state.isApiKey = true
    state.isStatistics = true
  }
})

function validateSettings(value: Partial<EndpointSettingsForm>): FormError<string>[] {
  return compactFormErrors(
    requiredTextError('name', value.name, t('admin.apis.routing.validation.nameRequired')),
    maxLengthError('name', value.name, 160, t('admin.apis.routing.validation.nameMaxLength')),
    integerRangeError('timeoutMs', value.timeoutMs, t('admin.apis.routing.validation.timeoutInvalid'), 100, 120_000),
    integerRangeError('maxRequestKiB', value.maxRequestKiB, t('admin.apis.routing.validation.requestSizeInvalid'), 0, 1_048_576),
    integerRangeError('maxResponseKiB', value.maxResponseKiB, t('admin.apis.routing.validation.responseSizeInvalid'), 0, 2_097_151),
    integerRangeError('creditsCost', value.creditsCost, t('admin.apis.routing.validation.creditsCostInvalid'), 0, 1_000_000),
    integerRangeError('rateLimitPerSecond', value.rateLimitPerSecond, t('admin.apis.routing.validation.rateLimitInvalid'), 0, 1_000_000),
    integerRangeError('rateLimitPerMinute', value.rateLimitPerMinute, t('admin.apis.routing.validation.rateLimitInvalid'), 0, 10_000_000),
    integerRangeError('rateLimitPerHour', value.rateLimitPerHour, t('admin.apis.routing.validation.rateLimitInvalid'), 0, 100_000_000),
    integerRangeError('rateLimitPerDay', value.rateLimitPerDay, t('admin.apis.routing.validation.rateLimitInvalid'), 0, 1_000_000_000),
    value.creditsCost && value.creditsCost > 0 && (!value.isApiKey || !value.isStatistics)
      ? { name: 'creditsCost', message: t('admin.apis.routing.validation.paidRouteRequiresGovernance') }
      : null,
    value.sensitiveQueryParameters?.some(parameter => !/^[A-Za-z0-9_.-]+$/.test(parameter))
      ? { name: 'sensitiveQueryParameters', message: t('admin.apis.routing.validation.sensitiveQueryInvalid') }
      : null
  )
}

async function onSubmit(event: FormSubmitEvent<EndpointSettingsForm>) {
  loading.value = true
  error.value = null
  try {
    const result = await $fetch<PlatformEndpointPublicationResult>(
      `/api/admin/v1/service-endpoints/${props.routeBinding.route.id}`,
      { method: 'PATCH', body: endpointSettingsPayload(event.data) }
    )
    open.value = false
    emit('saved', result)
  } catch (cause: unknown) {
    error.value = parseFetchError(cause, t('admin.apis.routing.feedback.updateFailed'))
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('admin.apis.routing.routeForm.editTitle')"
    :description="$t('admin.apis.routing.routeForm.editDescription')"
    :dismissible="!loading"
    :ui="adminModalUi({ content: 'sm:max-w-3xl' })"
  >
    <template #body>
      <UForm
        id="platform-endpoint-settings"
        :state="state"
        :validate="validateSettings"
        class="space-y-5"
        @submit="onSubmit"
      >
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
        />
        <div class="space-y-2 rounded-lg border border-default bg-elevated/30 p-4">
          <div class="flex items-start gap-2">
            <UBadge color="neutral" variant="subtle" class="font-mono">
              {{ routeBinding.route.method }}
            </UBadge>
            <span class="break-all font-mono text-sm text-highlighted">
              {{ routeBinding.route.pathPattern }}
            </span>
          </div>
          <p class="text-xs text-muted">
            {{ routeBinding.upstream.name }} · {{ routeBinding.product.name }} / {{ routeBinding.version.version }}
          </p>
        </div>

        <UFormField
          name="name"
          :label="$t('admin.apis.routing.fields.name')"
          required
        >
          <UInput
            v-model="state.name"
            :placeholder="$t('admin.apis.routing.routeForm.namePlaceholder')"
            class="w-full"
          />
        </UFormField>

        <UCollapsible
          v-model:open="advancedOpen"
          class="rounded-lg border border-default bg-elevated/30"
        >
          <button
            type="button"
            class="flex w-full items-start gap-3 p-4 text-left"
          >
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-semibold text-highlighted">
                {{ $t('admin.apis.routing.routeForm.governanceTitle') }}
              </h3>
              <p class="mt-1 text-xs leading-5 text-muted">
                {{ $t('admin.apis.routing.routeForm.governanceDescription') }}
              </p>
            </div>
            <UIcon
              name="i-lucide-chevron-down"
              class="mt-0.5 size-4 shrink-0 text-muted transition-transform"
              :class="advancedOpen ? 'rotate-180' : ''"
            />
          </button>

          <template #content>
            <div class="space-y-5 border-t border-default p-4">
              <div class="grid gap-4 sm:grid-cols-3">
                <UFormField :label="$t('admin.apis.routing.fields.apiKeyRequired')">
                  <USwitch
                    v-model="state.isApiKey"
                    :disabled="state.creditsCost > 0"
                  />
                </UFormField>
                <UFormField :label="$t('admin.apis.routing.fields.statisticsEnabled')">
                  <USwitch
                    v-model="state.isStatistics"
                    :disabled="state.creditsCost > 0"
                  />
                </UFormField>
                <UFormField
                  name="creditsCost"
                  :label="$t('admin.apis.routing.fields.creditsCost')"
                  :description="$t('admin.apis.routing.routeForm.creditsCostHelp')"
                >
                  <UInputNumber
                    v-model="state.creditsCost"
                    :min="0"
                    :max="1000000"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  name="catalogStatus"
                  :label="$t('admin.apis.routing.fields.catalogStatus')"
                  :description="$t('admin.apis.routing.routeForm.catalogStatusHelp')"
                >
                  <USelect
                    v-model="state.catalogStatus"
                    :items="catalogStatusItems"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  name="sensitiveQueryParameters"
                  :label="$t('admin.apis.routing.fields.sensitiveQueryParameters')"
                  :description="$t('admin.apis.routing.routeForm.sensitiveQueryHelp')"
                >
                  <UInputTags
                    v-model="state.sensitiveQueryParameters"
                    :placeholder="$t('admin.apis.routing.routeForm.sensitiveQueryPlaceholder')"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <div class="grid gap-4 sm:grid-cols-4">
                <UFormField name="rateLimitPerSecond" :label="$t('admin.apis.routing.fields.perSecond')">
                  <UInputNumber v-model="state.rateLimitPerSecond" :min="0" class="w-full" />
                </UFormField>
                <UFormField name="rateLimitPerMinute" :label="$t('admin.apis.routing.fields.perMinute')">
                  <UInputNumber v-model="state.rateLimitPerMinute" :min="0" class="w-full" />
                </UFormField>
                <UFormField name="rateLimitPerHour" :label="$t('admin.apis.routing.fields.perHour')">
                  <UInputNumber v-model="state.rateLimitPerHour" :min="0" class="w-full" />
                </UFormField>
                <UFormField name="rateLimitPerDay" :label="$t('admin.apis.routing.fields.perDay')">
                  <UInputNumber v-model="state.rateLimitPerDay" :min="0" class="w-full" />
                </UFormField>
              </div>

              <div class="grid gap-4 sm:grid-cols-3">
                <UFormField name="timeoutMs" :label="$t('admin.apis.routing.fields.timeoutMs')">
                  <UInputNumber
                    v-model="state.timeoutMs"
                    :min="100"
                    :max="120000"
                    :step="100"
                    class="w-full"
                  />
                </UFormField>
                <UFormField name="maxRequestKiB" :label="$t('admin.apis.routing.fields.maxRequestKiB')">
                  <UInputNumber
                    v-model="state.maxRequestKiB"
                    :min="0"
                    :max="1048576"
                    class="w-full"
                  />
                </UFormField>
                <UFormField name="maxResponseKiB" :label="$t('admin.apis.routing.fields.maxResponseKiB')">
                  <UInputNumber
                    v-model="state.maxResponseKiB"
                    :min="0"
                    :max="2097151"
                    class="w-full"
                  />
                </UFormField>
              </div>

              <UFormField
                name="enabled"
                :label="$t('admin.apis.routing.fields.routeState')"
                :description="$t('admin.apis.routing.routeForm.stateHelp')"
              >
                <USwitch
                  v-model="state.enabled"
                  :label="$t('common.actions.enable')"
                />
              </UFormField>
            </div>
          </template>
        </UCollapsible>
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
          form="platform-endpoint-settings"
          :loading="loading"
        >
          {{ $t('admin.apis.routing.actions.saveRoute') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
