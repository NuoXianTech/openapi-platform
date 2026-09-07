<script setup lang="ts">
import type { Form, FormErrorEvent } from '@nuxt/ui'
import type { ServiceConfigurationView } from '#shared/types/service-control'
import { useAdminServiceConfigurationForm, type ServiceConfigurationFormPayload } from '~/composables/admin/use-admin-service-configuration-form'

const props = defineProps<{
  view: ServiceConfigurationView
  loading?: boolean
  disabled?: boolean
  feedback?: {
    message: string
    description?: string
    color: 'success' | 'warning' | 'error'
  } | null
}>()
const emit = defineEmits<{ submit: [payload: ServiceConfigurationFormPayload] }>()
const formState = reactive({ ready: true })
const configurationForm = useTemplateRef<Form<typeof formState>>('configurationForm')
const formId = useId()
const busy = computed(() => props.loading || props.disabled)
const {
  activeGroup, groups, pendingChangeCount, groupChangeCount, revealField,
  booleanValue, numberValue, stringValue, stringArrayValue, setValue,
  secretValues, secretDirty, secretCleared, secretConfigured, setSecret, clearSecret, keepSecret,
  reset, validate, payload
} = useAdminServiceConfigurationForm(() => props.view)

function groupDomId(kind: string, key: string) {
  return [formId, kind, key].join('-')
}

async function onError(event: FormErrorEvent) {
  const error = event.errors[0]
  if (!error?.name) return
  revealField(error.name)
  await nextTick()
  if (error.id) document.getElementById(error.id)?.focus()
}

function onSubmit() {
  emit('submit', payload())
}

function discardChanges() {
  reset()
  configurationForm.value?.clear()
}
</script>

<template>
  <UForm
    ref="configurationForm"
    :state="formState"
    :validate="validate"
    class="space-y-4"
    @submit="onSubmit"
    @error="onError"
  >
    <div class="grid min-w-0 gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      <nav
        :aria-label="$t('admin.apis.routing.serviceControl.moduleNavigation')"
        class="min-w-0 lg:sticky lg:top-4 lg:self-start"
      >
        <p class="mb-2 hidden px-3 text-xs font-medium text-muted lg:block">
          {{ $t('admin.apis.routing.serviceControl.moduleNavigation') }}
        </p>
        <div class="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
          <button
            v-for="group in groups"
            :key="group.key"
            type="button"
            :aria-pressed="activeGroup === group.key"
            :aria-controls="groupDomId('panel', group.key)"
            :disabled="busy"
            class="flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors disabled:opacity-60"
            :class="activeGroup === group.key
              ? 'bg-elevated font-semibold text-highlighted ring-1 ring-inset ring-default'
              : 'text-muted hover:bg-elevated/60 hover:text-highlighted'"
            @click="activeGroup = group.key"
          >
            <span class="whitespace-nowrap lg:whitespace-normal">{{ group.label }}</span>
            <span
              v-if="groupChangeCount(group.key) > 0"
              class="size-1.5 shrink-0 rounded-full bg-warning"
              :aria-label="$t('admin.apis.routing.serviceControl.pendingChanges', { count: groupChangeCount(group.key) })"
            />
            <span v-else class="text-xs tabular-nums text-dimmed">{{ group.fields.length }}</span>
          </button>
        </div>
      </nav>

      <div class="min-w-0">
        <section
          v-for="group in groups"
          v-show="activeGroup === group.key"
          :id="groupDomId('panel', group.key)"
          :key="group.key"
          :aria-labelledby="groupDomId('title', group.key)"
          class="overflow-hidden rounded-lg border border-default bg-default"
        >
          <header class="space-y-1 border-b border-default bg-elevated/30 px-4 py-4 sm:px-5">
            <h3 :id="groupDomId('title', group.key)" class="text-base font-semibold text-highlighted">
              {{ group.label }}
            </h3>
            <p v-if="group.description" class="max-w-3xl text-sm leading-6 text-muted">
              {{ group.description }}
            </p>
          </header>

          <div class="space-y-5 p-4 sm:p-5">
            <UFormField
              v-for="field in group.fields"
              :key="field.key"
              :name="field.key"
              :label="field.label"
              :description="field.type === 'boolean' ? field.description : undefined"
              :help="field.type !== 'boolean' ? field.description : undefined"
              :required="field.required"
              :orientation="field.type === 'boolean' ? 'horizontal' : 'vertical'"
              class="min-w-0"
              :class="field.type === 'boolean' ? 'items-center rounded-md bg-elevated/40 p-4' : ''"
              :ui="{ container: 'min-w-0', help: 'mt-2 text-xs leading-5', description: 'mt-1 text-xs leading-5' }"
            >
              <template v-if="field.type === 'secret'" #hint>
                <UBadge
                  :color="secretConfigured(field.key) && !secretCleared[field.key] ? 'success' : 'neutral'"
                  variant="subtle"
                  size="xs"
                >
                  {{ secretConfigured(field.key) && !secretCleared[field.key]
                    ? $t('admin.apis.routing.serviceControl.secretConfigured')
                    : $t('admin.apis.routing.serviceControl.secretNotConfigured') }}
                </UBadge>
              </template>

              <USwitch
                v-if="field.type === 'boolean'"
                :model-value="booleanValue(field.key)"
                :disabled="busy"
                @update:model-value="setValue(field.key, $event)"
              />
              <UInputNumber
                v-else-if="field.type === 'number'"
                :model-value="numberValue(field.key)"
                :min="field.minimum"
                :max="field.maximum"
                :step="field.step"
                :disabled="busy"
                class="w-full sm:max-w-xs"
                @update:model-value="setValue(field.key, $event ?? field.default)"
              />
              <USelect
                v-else-if="field.type === 'single-select'"
                :model-value="stringValue(field.key)"
                :items="field.options"
                value-key="value"
                :disabled="busy"
                class="w-full sm:max-w-lg"
                @update:model-value="setValue(field.key, $event)"
              />
              <UCheckboxGroup
                v-else-if="field.type === 'multi-select' && field.options.length <= 12"
                :model-value="stringArrayValue(field.key)"
                :items="field.options"
                value-key="value"
                variant="card"
                color="neutral"
                :disabled="busy"
                :ui="{ fieldset: 'grid gap-2 sm:grid-cols-2', item: 'min-w-0', label: 'whitespace-normal', description: 'text-xs leading-5' }"
                @update:model-value="setValue(field.key, $event)"
              />
              <USelectMenu
                v-else-if="field.type === 'multi-select'"
                :model-value="stringArrayValue(field.key)"
                :items="field.options"
                value-key="value"
                multiple
                :disabled="busy"
                class="w-full"
                @update:model-value="setValue(field.key, $event)"
              >
                <template #default>
                  {{ $t('admin.apis.routing.serviceControl.selectedOptions', {
                    count: stringArrayValue(field.key).length,
                    total: field.options.length
                  }) }}
                </template>
              </USelectMenu>
              <UTextarea
                v-else-if="field.type === 'textarea'"
                :model-value="stringValue(field.key)"
                :placeholder="field.placeholder"
                :disabled="busy"
                autoresize
                :rows="3"
                :maxrows="10"
                class="w-full"
                @update:model-value="setValue(field.key, $event)"
              />
              <div v-else-if="field.type === 'secret'" class="flex min-w-0 items-center gap-2">
                <UInput
                  :model-value="secretValues[field.key]"
                  type="password"
                  autocomplete="new-password"
                  :placeholder="secretConfigured(field.key) && !secretDirty[field.key]
                    ? $t('admin.apis.routing.serviceControl.secretConfiguredPlaceholder')
                    : field.placeholder"
                  :disabled="busy"
                  class="min-w-0 flex-1 font-mono"
                  @update:model-value="setSecret(field.key, $event)"
                />
                <UTooltip
                  v-if="secretConfigured(field.key) && !secretCleared[field.key]"
                  :text="$t('admin.apis.routing.serviceControl.clearSecret')"
                  :disable-hoverable-content="true"
                  :ui="{ content: 'pointer-events-none' }"
                >
                  <UButton
                    color="error"
                    variant="ghost"
                    size="sm"
                    square
                    type="button"
                    icon="i-lucide-trash-2"
                    :disabled="busy"
                    :aria-label="$t('admin.apis.routing.serviceControl.clearSecret')"
                    @click="clearSecret(field.key)"
                  />
                </UTooltip>
                <UTooltip
                  v-if="secretDirty[field.key]"
                  :text="$t('admin.apis.routing.serviceControl.keepSecret')"
                  :disable-hoverable-content="true"
                  :ui="{ content: 'pointer-events-none' }"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    square
                    type="button"
                    icon="i-lucide-undo-2"
                    :disabled="busy"
                    :aria-label="$t('admin.apis.routing.serviceControl.keepSecret')"
                    @click="keepSecret(field.key)"
                  />
                </UTooltip>
              </div>
              <UInput
                v-else
                :model-value="stringValue(field.key)"
                :placeholder="field.placeholder"
                :disabled="busy"
                class="w-full"
                @update:model-value="setValue(field.key, $event)"
              />
            </UFormField>
          </div>
        </section>
      </div>
    </div>

    <div class="sticky bottom-0 z-10 flex flex-col gap-3 rounded-lg border border-default bg-default/95 p-3 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:px-4">
      <div class="min-w-0 text-sm" role="status" aria-live="polite">
        <template v-if="feedback && (pendingChangeCount === 0 || feedback.color === 'error')">
          <p :class="{ 'text-success': feedback.color === 'success', 'text-warning': feedback.color === 'warning', 'text-error': feedback.color === 'error' }">
            {{ feedback.message }}
          </p>
          <p v-if="feedback.description" class="mt-1 text-xs text-muted">{{ feedback.description }}</p>
        </template>
        <template v-else>
          <p :class="pendingChangeCount > 0 ? 'text-warning' : 'text-muted'">
            {{ pendingChangeCount > 0
              ? $t('admin.apis.routing.serviceControl.pendingChanges', { count: pendingChangeCount })
              : $t('admin.apis.routing.serviceControl.saveScope') }}
          </p>
        </template>
      </div>
      <div class="flex shrink-0 justify-end gap-2">
        <UButton
          type="button"
          color="neutral"
          variant="outline"
          :disabled="busy || pendingChangeCount === 0"
          @click="discardChanges"
        >
          {{ $t('admin.apis.routing.serviceControl.discardChanges') }}
        </UButton>
        <UButton
          type="submit"
          icon="i-lucide-save"
          :loading="loading"
          :disabled="disabled || (view.connection.configurationRevision > 0 && pendingChangeCount === 0)"
        >
          {{ $t('admin.apis.routing.serviceControl.saveConfiguration') }}
        </UButton>
      </div>
    </div>
  </UForm>
</template>
