<script setup lang="ts">
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import type {
  ServiceConfigurationSyncOutcome,
  ServiceConfigurationValue,
  ServiceConfigurationView
} from '#shared/types/service-control'
import { parseFetchError } from '~/utils/client-error'
import { formatPlatformDate, serviceAvailabilityColor, shortServiceCommit } from '~/utils/platform-display'
import type { PlatformUpstream, PlatformUpstreamTarget } from '#shared/types/platform'
import { UPSTREAM_CONSTRAINTS } from '#shared/schemas/platform-constraints'

const route = useRoute()
const { t, locale } = useI18n()
const toast = useToast()
const confirm = useConfirmDialog()
const upstreamId = computed(() => String(route.params.id ?? ''))
const resource = usePrivateResource<ServiceConfigurationView | null>({
  path: () => `/api/admin/v1/upstreams/${upstreamId.value}/service`,
  defaultData: () => null
})
const upstreamResource = usePrivateResource<PlatformUpstream[]>({
  path: '/api/admin/v1/upstreams',
  defaultData: () => []
})
const managementUpstream = computed(() => upstreamResource.data.value.find(
  upstream => upstream.id === upstreamId.value
) ?? null)
const targetModalOpen = ref(false)
const editingTarget = ref<PlatformUpstreamTarget | null>(null)

const discovering = ref(false)
const synchronizing = ref(false)
const saving = ref(false)
const updatingToken = ref(false)
const serviceToken = ref('')
const targetBusy = ref(new Set<string>())
interface ServiceFeedback {
  message: string
  description?: string
  color: 'success' | 'warning' | 'error'
}
const activeSection = ref('configuration')
const pageFeedback = ref<ServiceFeedback | null>(null)
const configurationFeedback = ref<ServiceFeedback | null>(null)
const tokenFeedback = ref<ServiceFeedback | null>(null)
const operationBusy = computed(() => discovering.value || synchronizing.value
  || saving.value || updatingToken.value || targetBusy.value.size > 0)
const controlBusy = computed(() => operationBusy.value || resource.loading.value || upstreamResource.loading.value)
const serviceName = computed(() => resource.data.value?.connection.serviceName
  || managementUpstream.value?.name || t('admin.apis.routing.serviceControl.pageTitle'))
const displayCommit = computed(() => shortServiceCommit(resource.data.value?.connection.serviceCommit))
const sectionItems = computed(() => [
  { value: 'configuration', slot: 'configuration', label: t('admin.apis.routing.serviceControl.tabs.configuration'), icon: 'i-lucide-sliders-horizontal' },
  { value: 'targets', slot: 'targets', label: t('admin.apis.routing.serviceControl.tabs.targets'), icon: 'i-lucide-server' },
  { value: 'connection', slot: 'connection', label: t('admin.apis.routing.serviceControl.tabs.connection'), icon: 'i-lucide-key-round' },
  { value: 'endpoints', slot: 'endpoints', label: t('admin.apis.routing.serviceControl.tabs.endpoints'), icon: 'i-lucide-list' }
])
const businessEndpoints = computed(() =>
  resource.data.value?.endpoints.filter(endpoint => (
    !endpoint.system && !endpoint.support
  )) ?? []
)
const connectionStatusColor = computed(() => {
  const connection = resource.data.value?.connection
  if (!connection?.discovered) return 'warning' as const
  return serviceAvailabilityColor(connection.availability)
})
const connectionStatusLabel = computed(() => {
  const connection = resource.data.value?.connection
  if (!connection?.discovered) {
    return t('admin.apis.routing.serviceControl.notDiscovered')
  }
  return t(
    `admin.apis.routing.serviceControl.availability.${connection.availability}`
  )
})

useHead({
  title: () => serviceName.value
})

watch(upstreamId, (id, previousId) => {
  if (!id || id === previousId) return
  serviceToken.value = ''
  pageFeedback.value = null
  configurationFeedback.value = null
  tokenFeedback.value = null
  activeSection.value = 'configuration'
  targetModalOpen.value = false
  editingTarget.value = null
  resource.data.value = null
  void resource.refresh()
  void upstreamResource.refresh()
})

function openTarget(target: PlatformUpstreamTarget | null = null) {
  editingTarget.value = target
  targetModalOpen.value = true
}

async function refreshTargets() {
  await Promise.all([resource.refresh(), upstreamResource.refresh()])
}

async function updateTargetStatus(target: PlatformUpstreamTarget) {
  await confirm({
    title: t('admin.apis.routing.toggleTarget.title', { name: target.baseUrl }),
    description: t('admin.apis.routing.toggleTarget.description'),
    confirmLabel: t(target.enabled ? 'common.actions.disable' : 'common.actions.enable'),
    confirmColor: target.enabled ? 'warning' : 'primary',
    onConfirm: async () => {
      const next = new Set(targetBusy.value)
      next.add(target.id)
      targetBusy.value = next
      try {
        await $fetch(`/api/admin/v1/targets/${target.id}`, {
          method: 'PATCH',
          body: { enabled: !target.enabled }
        })
        toast.add({ title: t('common.feedback.updated'), color: 'success' })
        await refreshTargets()
      } catch (error: unknown) {
        toast.add({ title: parseFetchError(error, t('common.feedback.operationFailed')), color: 'error' })
        throw error
      } finally {
        const updated = new Set(targetBusy.value)
        updated.delete(target.id)
        targetBusy.value = updated
      }
    }
  })
}

async function removeTarget(target: PlatformUpstreamTarget) {
  await confirm({
    title: t('admin.apis.routing.deleteTarget.title'),
    description: t('admin.apis.routing.deleteTarget.description'),
    confirmColor: 'error',
    onConfirm: async () => {
      try {
        await $fetch(`/api/admin/v1/targets/${target.id}`, { method: 'DELETE' })
        toast.add({ title: t('common.feedback.deleted'), color: 'success' })
        await refreshTargets()
      } catch (error: unknown) {
        toast.add({ title: parseFetchError(error, t('common.feedback.deleteFailed')), color: 'error' })
        throw error
      }
    }
  })
}

function targetItems(target: PlatformUpstreamTarget) {
  return [[
    { label: t('common.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => openTarget(target) },
    {
      label: t(target.enabled ? 'common.actions.disable' : 'common.actions.enable'),
      icon: target.enabled ? 'i-lucide-pause' : 'i-lucide-play',
      disabled: targetBusy.value.has(target.id),
      onSelect: () => updateTargetStatus(target)
    },
    { label: t('common.actions.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, onSelect: () => removeTarget(target) }
  ]]
}

function targetStatusColor(status: string) {
  if (status === 'synced') return 'success' as const
  if (status === 'drifted') return 'warning' as const
  if (status === 'error') return 'error' as const
  return 'neutral' as const
}

function targetAvailabilityColor(
  target: ServiceConfigurationView['targets'][number]
) {
  if (!target.enabled) return 'neutral' as const
  return serviceAvailabilityColor(target.availability)
}

function targetAvailabilityLabel(
  target: ServiceConfigurationView['targets'][number]
) {
  const status = target.enabled ? target.availability : 'disabled'
  return t(`admin.apis.routing.serviceControl.targetAvailability.${status}`)
}

function desiredRevisionLabel(revision: number) {
  return revision > 0
    ? t('admin.apis.routing.serviceControl.revisionLabel', { revision })
    : t('admin.apis.routing.serviceControl.configurationNotSaved')
}

function targetRevisionLabel(revision: number | null) {
  return revision !== null && revision > 0
    ? t('admin.apis.routing.serviceControl.revisionLabel', { revision })
    : null
}

function targetStatusLabel(target: ServiceConfigurationView['targets'][number]) {
  if (
    target.configurationStatus === 'unknown'
    && resource.data.value?.connection.configurationRevision === 0
    && target.configurationRevision === 0
  ) {
    return t('admin.apis.routing.serviceControl.targetStatuses.initial')
  }
  return t(
    `admin.apis.routing.serviceControl.targetStatuses.${target.configurationStatus}`
  )
}

async function discover() {
  if (controlBusy.value) return
  pageFeedback.value = null
  discovering.value = true
  try {
    const result = await $fetch<ServiceConfigurationView>(
      `/api/admin/v1/upstreams/${upstreamId.value}/discover`,
      { method: 'POST' }
    )
    resource.data.value = result
    pageFeedback.value = {
      message: result.connection.lastDiscoveryError
        ? t('admin.apis.routing.serviceControl.discoveryPartial')
        : t('admin.apis.routing.serviceControl.discoverySucceeded'),
      color: result.connection.lastDiscoveryError ? 'warning' : 'success'
    }
    await upstreamResource.refresh()
  } catch (error: unknown) {
    pageFeedback.value = {
      message: parseFetchError(
        error,
        t('admin.apis.routing.serviceControl.discoveryFailed')
      ),
      color: 'error'
    }
    await resource.refresh()
  } finally {
    discovering.value = false
  }
}

async function updateServiceToken() {
  if (controlBusy.value) return
  const token = serviceToken.value.trim()
  if (token.length < UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MIN_LENGTH
    || token.length > UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MAX_LENGTH) {
    tokenFeedback.value = {
      message: t('admin.apis.routing.validation.serviceTokenInvalid'),
      color: 'error'
    }
    return
  }
  updatingToken.value = true
  tokenFeedback.value = null
  try {
    await $fetch(`/api/admin/v1/upstreams/${upstreamId.value}/token`, {
      method: 'PUT',
      body: { serviceToken: token }
    })
    serviceToken.value = ''
    tokenFeedback.value = {
      message: t('admin.apis.routing.serviceControl.tokenUpdated'),
      description: t('admin.apis.routing.serviceControl.rediscoverAfterToken'),
      color: 'success'
    }
    await resource.refresh()
  } catch (error: unknown) {
    tokenFeedback.value = {
      message: parseFetchError(
        error,
        t('admin.apis.routing.serviceControl.tokenUpdateFailed')
      ),
      color: 'error'
    }
  } finally {
    updatingToken.value = false
  }
}

async function saveConfiguration(payload: {
  expectedRevision: number
  values: Record<string, ServiceConfigurationValue>
  secrets: Record<string, string | null>
}) {
  if (controlBusy.value) return
  saving.value = true
  configurationFeedback.value = null
  try {
    const result = await $fetch<ServiceConfigurationSyncOutcome>(
      `/api/admin/v1/upstreams/${upstreamId.value}/configuration`,
      { method: 'PUT', body: payload }
    )
    configurationFeedback.value = {
      message: result.status === 'synced'
        ? t('admin.apis.routing.serviceControl.configurationSynced')
        : result.status === 'partial'
          ? t('admin.apis.routing.serviceControl.configurationPartial')
          : t('admin.apis.routing.serviceControl.configurationFailed'),
      description: t(
        'admin.apis.routing.serviceControl.configurationRevision',
        { revision: result.revision }
      ),
      color: result.status === 'synced'
        ? 'success'
        : result.status === 'partial' ? 'warning' : 'error'
    }
    await resource.refresh()
  } catch (error: unknown) {
    configurationFeedback.value = {
      message: parseFetchError(
        error,
        t('admin.apis.routing.serviceControl.configurationSaveFailed')
      ),
      color: 'error'
    }
  } finally {
    saving.value = false
  }
}

async function synchronizeConfiguration() {
  if (controlBusy.value) return
  synchronizing.value = true
  pageFeedback.value = null
  try {
    const result = await $fetch<ServiceConfigurationSyncOutcome>(
      `/api/admin/v1/upstreams/${upstreamId.value}/configuration/sync`,
      { method: 'POST' }
    )
    pageFeedback.value = {
      message: result.status === 'synced'
        ? t('admin.apis.routing.serviceControl.configurationSynced')
        : result.status === 'partial'
          ? t('admin.apis.routing.serviceControl.configurationPartial')
          : t('admin.apis.routing.serviceControl.configurationFailed'),
      color: result.status === 'synced'
        ? 'success'
        : result.status === 'partial' ? 'warning' : 'error'
    }
    await resource.refresh()
  } catch (error: unknown) {
    pageFeedback.value = {
      message: parseFetchError(
        error,
        t('admin.apis.routing.serviceControl.configurationSyncFailed')
      ),
      color: 'error'
    }
  } finally {
    synchronizing.value = false
  }
}
</script>

<template>
  <div class="mx-auto w-full max-w-7xl space-y-5">
    <header class="space-y-3">
      <UButton
        to="/admin/apis/upstreams"
        color="neutral"
        variant="link"
        icon="i-lucide-arrow-left"
        class="px-0"
      >
        {{ $t('admin.apis.routing.serviceControl.backToUpstreams') }}
      </UButton>
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="min-w-0 space-y-2">
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="break-words text-xl font-semibold text-highlighted">{{ serviceName }}</h1>
            <UBadge v-if="resource.data.value" :color="connectionStatusColor" variant="subtle">
              {{ connectionStatusLabel }}
            </UBadge>
          </div>
          <p class="text-sm text-muted">{{ $t('admin.apis.routing.serviceControl.pageDescription') }}</p>
          <div v-if="resource.data.value" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span class="flex min-w-0 items-center gap-1.5">
              {{ $t('admin.apis.routing.serviceControl.serviceVersion') }}
              <code class="max-w-48 truncate text-toned" :title="resource.data.value.connection.serviceVersion || undefined">
                {{ resource.data.value.connection.serviceVersion || '—' }}
              </code>
            </span>
            <span class="flex min-w-0 items-center gap-1.5">
              {{ $t('admin.apis.routing.serviceControl.commit') }}
              <code
                class="max-w-40 truncate text-toned"
                :title="resource.data.value.connection.serviceCommit || undefined"
              >{{ displayCommit }}</code>
            </span>
            <span>{{ $t('admin.apis.routing.catalog.endpointCount', { count: businessEndpoints.length }) }}</span>
          </div>
        </div>
        <div class="flex shrink-0 flex-wrap gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-refresh-cw"
            :loading="resource.loading.value || upstreamResource.loading.value"
            :disabled="operationBusy"
            @click="refreshTargets"
          >{{ $t('common.actions.refresh') }}</UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-scan-search"
            :loading="discovering"
            :disabled="controlBusy"
            @click="discover"
          >{{ $t('admin.apis.routing.serviceControl.discover') }}</UButton>
        </div>
      </div>
    </header>

    <UAlert
      v-if="pageFeedback"
      :color="pageFeedback.color"
      variant="subtle"
      icon="i-lucide-info"
      :title="pageFeedback.message"
      :description="pageFeedback.description"
    />
    <UAlert
      v-if="resource.error.value || upstreamResource.error.value"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="$t('common.feedback.loadFailed')"
      :description="parseFetchError(resource.error.value || upstreamResource.error.value, $t('common.feedback.loadFailed'))"
    />
    <UAlert
      v-if="resource.data.value?.connection.lastDiscoveryError"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="$t('admin.apis.routing.serviceControl.lastDiscoveryErrorTitle')"
      :description="resource.data.value.connection.lastDiscoveryError"
    />

    <div v-if="resource.loading.value && !resource.data.value" class="space-y-4" aria-busy="true">
      <USkeleton class="h-10 w-full rounded-md" />
      <div class="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <USkeleton class="h-56 rounded-lg" />
        <USkeleton class="h-96 rounded-lg" />
      </div>
    </div>

    <template v-if="resource.data.value">
      <UTabs
        v-model="activeSection"
        :items="sectionItems"
        :unmount-on-hide="false"
        variant="link"
        color="neutral"
        :ui="{ list: 'w-full justify-start overflow-x-auto overflow-y-hidden', trigger: 'shrink-0', indicator: 'bottom-0' }"
      >
        <template #configuration>
          <section class="space-y-4">
            <template v-if="resource.data.value.connection.discovered">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-base font-semibold text-highlighted">
                      {{ $t('admin.apis.routing.serviceControl.configurationTitle') }}
                    </h2>
                    <UBadge color="neutral" variant="subtle" size="sm">
                      {{ desiredRevisionLabel(resource.data.value.connection.configurationRevision) }}
                    </UBadge>
                  </div>
                  <p class="text-sm text-muted">{{ $t('admin.apis.routing.serviceControl.configurationDescription') }}</p>
                </div>
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-refresh-cw"
                  :disabled="controlBusy || resource.data.value.connection.configurationRevision < 1"
                  :loading="synchronizing"
                  @click="synchronizeConfiguration"
                >{{ $t('admin.apis.routing.serviceControl.syncAllTargets') }}</UButton>
              </div>
              <p class="flex items-start gap-2 text-xs leading-5 text-muted">
                <UIcon name="i-lucide-shield-check" class="mt-0.5 size-4 shrink-0" />
                {{ $t('admin.apis.routing.serviceControl.secretBoundaryDescription') }}
              </p>
              <AdminServiceConfigurationForm
                v-if="resource.data.value.definition?.groups.length"
                :view="resource.data.value"
                :loading="saving"
                :disabled="controlBusy && !saving"
                :feedback="configurationFeedback"
                @submit="saveConfiguration"
              />
              <UEmpty
                v-else
                icon="i-lucide-sliders-horizontal"
                :title="$t('admin.apis.routing.serviceControl.noConfiguration')"
                :description="$t('admin.apis.routing.serviceControl.noConfigurationDescription')"
              />
            </template>
            <UEmpty
              v-else
              icon="i-lucide-scan-search"
              :title="$t('admin.apis.routing.serviceControl.discoverFirstTitle')"
              :description="$t('admin.apis.routing.serviceControl.discoverFirstDescription')"
            >
              <template #actions>
                <UButton :loading="discovering" :disabled="controlBusy" @click="discover">
                  {{ $t('admin.apis.routing.serviceControl.discover') }}
                </UButton>
                <UButton color="neutral" variant="outline" @click="activeSection = 'targets'">
                  {{ $t('admin.apis.routing.serviceControl.tabs.targets') }}
                </UButton>
                <UButton color="neutral" variant="outline" @click="activeSection = 'connection'">
                  {{ $t('admin.apis.routing.serviceControl.tabs.connection') }}
                </UButton>
              </template>
            </UEmpty>
          </section>
        </template>

        <template #targets>
          <section>
            <UCard variant="subtle">
              <template #header>
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="space-y-1">
                    <h2 class="text-base font-semibold text-highlighted">{{ $t('admin.apis.routing.serviceControl.targetsTitle') }}</h2>
                    <p class="text-sm text-muted">{{ $t('admin.apis.routing.serviceControl.targetsDescription') }}</p>
                  </div>
                  <UButton
                    color="neutral"
                    variant="outline"
                    size="sm"
                    icon="i-lucide-plus"
                    :disabled="!managementUpstream || controlBusy"
                    @click="openTarget()"
                  >{{ $t('admin.apis.routing.actions.addTarget') }}</UButton>
                </div>
              </template>
              <div class="divide-y divide-default">
                <div
                  v-for="target in resource.data.value.targets"
                  :key="target.id"
                  class="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 lg:flex-row lg:items-center"
                >
                  <div class="flex min-w-0 flex-1 items-start gap-3">
                    <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-elevated text-muted">
                      <UIcon name="i-lucide-server" class="size-4" />
                    </div>
                    <div class="min-w-0 flex-1">
                      <p class="break-all font-mono text-sm text-highlighted">{{ target.baseUrl }}</p>
                      <p v-if="target.lastError" class="mt-1 break-words text-xs text-error">{{ target.lastError }}</p>
                    </div>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge :color="targetAvailabilityColor(target)" variant="subtle">{{ targetAvailabilityLabel(target) }}</UBadge>
                    <UBadge :color="targetStatusColor(target.configurationStatus)" variant="subtle">{{ targetStatusLabel(target) }}</UBadge>
                    <span v-if="targetRevisionLabel(target.configurationRevision)" class="font-mono text-xs text-muted">
                      {{ targetRevisionLabel(target.configurationRevision) }}
                    </span>
                    <UDropdownMenu
                      v-if="managementUpstream?.targets.find(item => item.id === target.id)"
                      :items="targetItems(managementUpstream.targets.find(item => item.id === target.id)!)"
                      :content="{ align: 'end' }"
                    >
                      <UButton
                        icon="i-lucide-ellipsis"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        :disabled="controlBusy"
                        :aria-label="$t('common.actions.more')"
                      />
                    </UDropdownMenu>
                  </div>
                </div>
              </div>
              <UEmpty v-if="resource.data.value.targets.length === 0" icon="i-lucide-server-off" :title="$t('admin.apis.routing.empty.targetsTitle')" />
            </UCard>
          </section>
        </template>

        <template #connection>
          <section>
            <UCard variant="subtle">
              <template #header>
                <h2 class="text-base font-semibold text-highlighted">{{ $t('admin.apis.routing.serviceControl.connectionTitle') }}</h2>
                <p class="mt-1 text-sm text-muted">{{ $t('admin.apis.routing.serviceControl.connectionDescription') }}</p>
              </template>
              <dl class="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt class="text-xs text-muted">{{ $t('admin.apis.routing.serviceControl.serviceId') }}</dt>
                  <dd class="mt-1 break-all font-mono text-sm text-highlighted">{{ resource.data.value.connection.serviceId || '—' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted">{{ $t('admin.apis.routing.serviceControl.lastDiscovered') }}</dt>
                  <dd class="mt-1 text-sm text-highlighted">{{ formatPlatformDate(resource.data.value.connection.lastDiscoveredAt, locale) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted">{{ $t('admin.apis.routing.serviceControl.desiredRevision') }}</dt>
                  <dd class="mt-1 text-sm text-highlighted">{{ desiredRevisionLabel(resource.data.value.connection.configurationRevision) }}</dd>
                </div>
              </dl>
              <USeparator class="my-5" />
              <form class="space-y-4" @submit.prevent="updateServiceToken">
                <UFormField
                  name="serviceToken"
                  :label="$t('admin.apis.routing.serviceControl.replaceToken')"
                  :help="$t('admin.apis.routing.serviceControl.replaceTokenDescription')"
                >
                  <div class="flex flex-col gap-2 sm:flex-row">
                    <UInput
                      v-model="serviceToken"
                      type="password"
                      autocomplete="new-password"
                      :placeholder="$t('admin.apis.routing.upstreamForm.serviceTokenPlaceholder')"
                      :disabled="controlBusy"
                      class="min-w-0 flex-1 font-mono"
                    />
                    <UButton
                      type="submit"
                      color="neutral"
                      variant="outline"
                      :loading="updatingToken"
                      :disabled="controlBusy || !serviceToken.trim()"
                    >{{ $t('admin.apis.routing.serviceControl.updateToken') }}</UButton>
                  </div>
                </UFormField>
                <UAlert
                  v-if="tokenFeedback"
                  :color="tokenFeedback.color"
                  variant="subtle"
                  icon="i-lucide-info"
                  :title="tokenFeedback.message"
                  :description="tokenFeedback.description"
                />
              </form>
            </UCard>
          </section>
        </template>

        <template #endpoints>
          <section>
            <UCard variant="subtle">
              <template #header>
                <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="space-y-1">
                    <h2 class="text-base font-semibold text-highlighted">{{ $t('admin.apis.routing.serviceControl.endpointsTitle') }}</h2>
                    <p class="text-sm text-muted">{{ $t('admin.apis.routing.serviceControl.endpointsDescription', { count: businessEndpoints.length }) }}</p>
                  </div>
                  <UButton
                    :to="{ path: '/admin/apis', query: { ...route.query, upstreamId } }"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    icon="i-lucide-arrow-up-right"
                  >{{ $t('admin.apis.routing.catalog.actions.managePublishing') }}</UButton>
                </div>
              </template>
              <div v-if="businessEndpoints.length" class="divide-y divide-default">
                <div
                  v-for="endpoint in businessEndpoints"
                  :key="endpoint.method + ':' + endpoint.path"
                  class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <ApiHttpMethodBadge :method="endpoint.method" size="xs" />
                  <code class="min-w-0 flex-1 break-all text-xs text-highlighted">{{ endpoint.path }}</code>
                  <span class="text-xs text-muted sm:max-w-sm sm:text-right">{{ endpoint.summary || endpoint.operationId || '—' }}</span>
                </div>
              </div>
              <UEmpty v-else icon="i-lucide-file-question" :title="$t('admin.apis.routing.serviceControl.noEndpoints')" />
            </UCard>
          </section>
        </template>
      </UTabs>
    </template>

    <AdminPlatformTargetModal
      v-if="managementUpstream"
      v-model:open="targetModalOpen"
      :upstream="managementUpstream"
      :target="editingTarget"
      @saved="refreshTargets"
    />
  </div>
</template>
