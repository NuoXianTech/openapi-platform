<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import type { PlatformUpstreamSummary } from '#shared/types/platform'
import { validateUpstreamTargetUrl } from '#shared/utils/upstream-target'
import { UPSTREAM_CONSTRAINTS } from '#shared/schemas/platform-constraints'
import { adminModalUi } from '~/utils/admin-modal-ui'
import { parseFetchError } from '~/utils/client-error'
import { compactFormErrors, integerRangeError, maxLengthError, requiredTextError } from '~/utils/form-validation'

const open = defineModel<boolean>('open', { default: false })
const props = defineProps<{
  upstream?: PlatformUpstreamSummary | null
}>()
const emit = defineEmits<{ saved: [] }>()
const toast = useToast()
const { t } = useI18n()

interface UpstreamTargetFormState {
  baseUrl: string
  weight: number
}

interface UpstreamFormState {
  name: string
  slug: string
  serviceToken: string
  loadBalancing: 'round_robin' | 'weighted'
  targets: UpstreamTargetFormState[]
}

function initialState(): UpstreamFormState {
  return {
    name: props.upstream?.name ?? '',
    slug: props.upstream?.slug ?? '',
    serviceToken: '',
    loadBalancing: props.upstream?.loadBalancing ?? 'round_robin',
    targets: [{ baseUrl: '', weight: 1 }]
  }
}

const state = reactive<UpstreamFormState>(initialState())
const loading = ref(false)
const isEditing = computed(() => Boolean(props.upstream))
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const loadBalancingItems = computed(() => [
  { label: t('admin.apis.routing.loadBalancing.roundRobin'), value: 'round_robin' },
  { label: t('admin.apis.routing.loadBalancing.weighted'), value: 'weighted' }
])

watch(open, (isOpen) => {
  if (isOpen) Object.assign(state, initialState())
})

function addTarget() {
  state.targets.push({ baseUrl: '', weight: 1 })
}

function removeTarget(index: number) {
  if (state.targets.length > 1) state.targets.splice(index, 1)
}

function validateUpstreamForm(value: Partial<UpstreamFormState>): FormError<string>[] {
  const errors = compactFormErrors(
    requiredTextError('name', value.name, t('admin.apis.routing.validation.nameRequired')),
    maxLengthError('name', value.name, 160, t('admin.apis.routing.validation.nameMaxLength')),
    requiredTextError('slug', value.slug, t('admin.apis.routing.validation.slugRequired')),
    value.slug && !slugPattern.test(value.slug.trim())
      ? { name: 'slug', message: t('admin.apis.routing.validation.slugInvalid') }
      : null,
    maxLengthError('slug', value.slug, 80, t('admin.apis.routing.validation.slugMaxLength'))
  )

  const serviceToken = value.serviceToken?.trim() ?? ''
  if ((!isEditing.value || serviceToken) && (
    serviceToken.length < UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MIN_LENGTH
    || serviceToken.length > UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MAX_LENGTH
  )) {
    errors.push({
      name: 'serviceToken',
      message: t('admin.apis.routing.validation.serviceTokenInvalid')
    })
  }

  if (isEditing.value) return errors

  const targets = value.targets ?? []
  if (targets.length === 0) {
    errors.push({ name: 'targets', message: t('admin.apis.routing.validation.targetRequired') })
    return errors
  }

  targets.forEach((target, index) => {
    const name = `targets.${index}.baseUrl`
    const validation = validateUpstreamTargetUrl(target.baseUrl?.trim() ?? '')
    if (target.baseUrl?.trim() && validation.issue) {
      errors.push({
        name,
        message: validation.issue === 'publicHttp'
          ? t('admin.apis.routing.validation.publicTargetHttpsRequired')
          : t('admin.apis.routing.validation.targetUrlInvalid')
      })
    }
    const weightError = integerRangeError(
      `targets.${index}.weight`,
      target.weight,
      t('admin.apis.routing.validation.weightInvalid'),
      1,
      10_000
    )
    if (weightError) errors.push(weightError)
  })
  return errors
}

async function onSubmit(event: FormSubmitEvent<UpstreamFormState>) {
  loading.value = true
  try {
    await $fetch(
      isEditing.value ? `/api/admin/v1/upstreams/${props.upstream!.id}` : '/api/admin/v1/upstreams',
      {
        method: isEditing.value ? 'PATCH' : 'POST',
        body: isEditing.value
          ? {
              name: event.data.name.trim(),
              slug: event.data.slug.trim(),
              loadBalancing: event.data.loadBalancing
            }
          : {
              name: event.data.name.trim(),
              slug: event.data.slug.trim(),
              serviceToken: event.data.serviceToken.trim(),
              loadBalancing: event.data.loadBalancing,
              targets: event.data.targets.map(target => ({
                baseUrl: target.baseUrl.trim(),
                weight: target.weight
              }))
            }
      }
    )
    if (isEditing.value && event.data.serviceToken.trim()) {
      await $fetch(`/api/admin/v1/upstreams/${props.upstream!.id}/token`, {
        method: 'PUT',
        body: { serviceToken: event.data.serviceToken.trim() }
      })
    }
    toast.add({
      title: t(isEditing.value
        ? 'admin.apis.routing.feedback.upstreamUpdated'
        : 'admin.apis.routing.feedback.upstreamCreated'),
      color: 'success'
    })
    open.value = false
    emit('saved')
  } catch (error: unknown) {
    toast.add({ title: parseFetchError(error, t('admin.apis.routing.feedback.createFailed')), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t(isEditing ? 'admin.apis.routing.upstreamForm.editTitle' : 'admin.apis.routing.upstreamForm.title')"
    :description="$t(isEditing ? 'admin.apis.routing.upstreamForm.editDescription' : 'admin.apis.routing.upstreamForm.description')"
    :dismissible="!loading"
    :ui="adminModalUi({ content: 'sm:max-w-3xl' })"
  >
    <template #body>
      <UForm
        id="platform-upstream-form"
        :state="state"
        :validate="validateUpstreamForm"
        class="space-y-5"
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
              :placeholder="$t('admin.apis.routing.upstreamForm.namePlaceholder')"
              class="w-full"
            />
          </UFormField>
          <UFormField
            name="slug"
            :label="$t('admin.apis.routing.fields.slug')"
            :description="$t('admin.apis.routing.fields.slugHelp')"
            required
          >
            <UInput
              v-model="state.slug"
              placeholder="core-api"
              class="w-full font-mono"
            />
          </UFormField>
        </div>

        <UFormField
          v-if="isEditing"
          name="serviceToken"
          :label="$t('admin.apis.routing.fields.serviceToken')"
          :description="$t('admin.apis.routing.upstreamForm.serviceTokenEditHelp')"
        >
          <UInput
            v-model="state.serviceToken"
            type="password"
            autocomplete="new-password"
            :placeholder="$t('admin.apis.routing.upstreamForm.serviceTokenPlaceholder')"
            class="w-full font-mono"
          />
        </UFormField>

        <div
          v-else
          class="rounded-lg border border-default bg-elevated/30 p-4"
        >
          <div class="mb-4 flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <UIcon
                name="i-lucide-network"
                class="size-4.5"
              />
            </div>
            <div>
              <h3 class="text-sm font-semibold text-highlighted">
                {{ $t('admin.apis.routing.upstreamForm.connectionTitle') }}
              </h3>
              <p class="mt-1 text-xs leading-5 text-muted">
                {{ $t('admin.apis.routing.upstreamForm.connectionDescription') }}
              </p>
            </div>
          </div>
          <UFormField
            name="serviceToken"
            :label="$t('admin.apis.routing.fields.serviceToken')"
            :description="$t('admin.apis.routing.upstreamForm.serviceTokenHelp')"
            required
          >
            <UInput
              v-model="state.serviceToken"
              type="password"
              autocomplete="new-password"
              :placeholder="$t('admin.apis.routing.upstreamForm.serviceTokenPlaceholder')"
              class="w-full font-mono"
            />
          </UFormField>
        </div>

        <!--
          Editing keeps load balancing on its own: Targets are managed from the
          Upstream detail page, so there is no Target list to sit beside here.
        -->
        <UFormField
          v-if="isEditing"
          name="loadBalancing"
          :label="$t('admin.apis.routing.fields.loadBalancing')"
          :description="$t('admin.apis.routing.upstreamForm.loadBalancingHelp')"
        >
          <USelect
            v-model="state.loadBalancing"
            :items="loadBalancingItems"
            value-key="value"
            class="w-full sm:w-72"
          />
        </UFormField>

        <div
          v-else
          class="rounded-lg border border-default bg-elevated/30 p-4"
        >
          <div class="mb-4 flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <UIcon
                name="i-lucide-server"
                class="size-4.5"
              />
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-sm font-semibold text-highlighted">
                {{ $t('admin.apis.routing.upstreamForm.targetsTitle') }}
              </h3>
              <p class="mt-1 text-xs leading-5 text-muted">
                {{ $t('admin.apis.routing.upstreamForm.targetsDescription') }}
              </p>
            </div>
          </div>

          <!-- Load balancing lives here: it decides whether weights apply. -->
          <UFormField
            name="loadBalancing"
            :label="$t('admin.apis.routing.fields.loadBalancing')"
            :description="$t('admin.apis.routing.upstreamForm.loadBalancingHelp')"
            class="mb-4"
          >
            <USelect
              v-model="state.loadBalancing"
              :items="loadBalancingItems"
              value-key="value"
              class="w-full sm:w-72"
            />
          </UFormField>

          <UFormField name="targets">
            <div class="space-y-2">
              <div
                v-for="(target, index) in state.targets"
                :key="index"
                class="rounded-lg border border-default bg-default p-3"
              >
                <span
                  v-if="state.targets.length > 1"
                  class="mb-2 block font-mono text-xs font-semibold text-muted"
                >
                  {{ $t('admin.apis.routing.upstreamForm.targetLabel', {
                    number: index + 1
                  }) }}
                </span>
                <div
                  class="grid gap-3"
                  :class="state.loadBalancing === 'weighted'
                    ? 'sm:grid-cols-[minmax(0,1fr)_6rem]'
                    : 'sm:grid-cols-1'"
                >
                  <UFormField
                    :name="`targets.${index}.baseUrl`"
                    :label="$t('admin.apis.routing.fields.baseUrl')"
                    class="min-w-0"
                    required
                  >
                    <!--
                      The remove button shares the field group so it aligns with
                      the input itself rather than guessing at a label offset.
                    -->
                    <div class="flex min-w-0 items-center gap-2">
                      <UInput
                        v-model="target.baseUrl"
                        :placeholder="$t('admin.apis.routing.upstreamForm.targetPlaceholder')"
                        class="min-w-0 flex-1 font-mono"
                      />
                      <UButton
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        square
                        icon="i-lucide-trash-2"
                        :disabled="state.targets.length === 1"
                        :aria-label="$t('admin.apis.routing.actions.removeTarget')"
                        @click="removeTarget(index)"
                      />
                    </div>
                  </UFormField>
                  <UFormField
                    v-if="state.loadBalancing === 'weighted'"
                    :name="`targets.${index}.weight`"
                    :label="$t('admin.apis.routing.fields.weight')"
                  >
                    <UInputNumber
                      v-model="target.weight"
                      :min="1"
                      :max="10000"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </div>
            </div>
          </UFormField>

          <UButton
            class="mt-3"
            color="neutral"
            variant="outline"
            size="sm"
            icon="i-lucide-plus"
            block
            @click="addTarget"
          >
            {{ $t('admin.apis.routing.actions.addTarget') }}
          </UButton>
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
          form="platform-upstream-form"
          :loading="loading"
        >
          {{ $t(isEditing ? 'common.actions.save' : 'admin.apis.routing.actions.createUpstream') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
