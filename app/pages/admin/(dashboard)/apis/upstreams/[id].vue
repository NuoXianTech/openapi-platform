<script setup lang="ts">
import { useAdminServiceControl } from '~/composables/admin/use-admin-service-control'
import type { ServiceConfigurationView } from '#shared/types/service-control'
import type { PlatformUpstreamTarget } from '#shared/types/platform'
import { parseFetchError } from '~/utils/client-error'
import { formatPlatformDate, serviceAvailabilityColor, shortServiceCommit } from '~/utils/platform-display'

const route = useRoute()
const { t, locale } = useI18n()
const upstreamId = computed(() => String(route.params.id ?? ''))
const {
  view,
  managementUpstream,
  loading,
  loadError,
  controls,
  serviceToken,
  pageFeedback,
  configurationFeedback,
  tokenFeedback,
  targetOperations,
  refresh,
  discover,
  updateServiceToken,
  saveConfiguration,
  synchronizeConfiguration
} = useAdminServiceControl(upstreamId)
const targetState = targetOperations.state
const targetModalOpen = ref(false)
const editingTarget = ref<PlatformUpstreamTarget | null>(null)
const activeSection = ref('configuration')
const serviceName = computed(() => view.value?.connection.serviceName
  || managementUpstream.value?.name || t('admin.apis.routing.serviceControl.pageTitle'))
const displayCommit = computed(() => shortServiceCommit(view.value?.connection.serviceCommit))
const sectionItems = computed(() => [
  { value: 'configuration', slot: 'configuration', label: t('admin.apis.routing.serviceControl.tabs.configuration'), icon: 'i-lucide-sliders-horizontal' },
  { value: 'targets', slot: 'targets', label: t('admin.apis.routing.serviceControl.tabs.targets'), icon: 'i-lucide-server' },
  { value: 'connection', slot: 'connection', label: t('admin.apis.routing.serviceControl.tabs.connection'), icon: 'i-lucide-key-round' },
  { value: 'endpoints', slot: 'endpoints', label: t('admin.apis.routing.serviceControl.tabs.endpoints'), icon: 'i-lucide-list' }
])
const businessEndpoints = computed(() =>
  view.value?.endpoints.filter(endpoint => (
    !endpoint.system && !endpoint.support
  )) ?? []
)
const connectionStatusColor = computed(() => {
  const connection = view.value?.connection
  if (!connection?.discovered) return 'warning' as const
  return serviceAvailabilityColor(connection.availability)
})
const connectionStatusLabel = computed(() => {
  const connection = view.value?.connection
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
  activeSection.value = 'configuration'
  targetModalOpen.value = false
  editingTarget.value = null
})

function openTarget(target: PlatformUpstreamTarget | null = null) {
  if (!managementUpstream.value || targetState.value.disabled) return
  editingTarget.value = target
  targetModalOpen.value = true
}

function targetItems(target: PlatformUpstreamTarget) {
  return [[
    { label: t('common.actions.edit'), icon: 'i-lucide-pencil', disabled: targetState.value.disabled, onSelect: () => openTarget(target) },
    {
      label: t(target.enabled ? 'common.actions.disable' : 'common.actions.enable'),
      icon: target.enabled ? 'i-lucide-pause' : 'i-lucide-play',
      disabled: targetState.value.disabled,
      onSelect: () => targetOperations.toggle(target)
    },
    { label: t('common.actions.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, disabled: targetState.value.disabled, onSelect: () => targetOperations.remove(target) }
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
    && view.value?.connection.configurationRevision === 0
    && target.configurationRevision === 0
  ) {
    return t('admin.apis.routing.serviceControl.targetStatuses.initial')
  }
  return t(
    `admin.apis.routing.serviceControl.targetStatuses.${target.configurationStatus}`
  )
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
            <UBadge v-if="view" :color="connectionStatusColor" variant="subtle">
              {{ connectionStatusLabel }}
            </UBadge>
          </div>
          <p class="text-sm text-muted">{{ $t('admin.apis.routing.serviceControl.pageDescription') }}</p>
          <div v-if="view" class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span class="flex min-w-0 items-center gap-1.5">
              {{ $t('admin.apis.routing.serviceControl.serviceVersion') }}
              <code class="max-w-48 truncate text-toned" :title="view.connection.serviceVersion || undefined">
                {{ view.connection.serviceVersion || '—' }}
              </code>
            </span>
            <span class="flex min-w-0 items-center gap-1.5">
              {{ $t('admin.apis.routing.serviceControl.commit') }}
              <code
                class="max-w-40 truncate text-toned"
                :title="view.connection.serviceCommit || undefined"
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
            :loading="loading"
            :disabled="controls.refreshDisabled"
            @click="refresh"
          >{{ $t('common.actions.refresh') }}</UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-scan-search"
            :loading="controls.discovering"
            :disabled="controls.discoverDisabled"
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
      v-if="loadError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="$t('common.feedback.loadFailed')"
      :description="parseFetchError(loadError, $t('common.feedback.loadFailed'))"
    />
    <UAlert
      v-if="view?.connection.lastDiscoveryError"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="$t('admin.apis.routing.serviceControl.lastDiscoveryErrorTitle')"
      :description="view.connection.lastDiscoveryError"
    />

    <div v-if="loading && !view" class="space-y-4" aria-busy="true">
      <USkeleton class="h-10 w-full rounded-md" />
      <div class="grid gap-5 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <USkeleton class="h-56 rounded-lg" />
        <USkeleton class="h-96 rounded-lg" />
      </div>
    </div>

    <template v-if="view">
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
            <template v-if="view.connection.discovered">
              <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="space-y-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-base font-semibold text-highlighted">
                      {{ $t('admin.apis.routing.serviceControl.configurationTitle') }}
                    </h2>
                    <UBadge color="neutral" variant="subtle" size="sm">
                      {{ desiredRevisionLabel(view.connection.configurationRevision) }}
                    </UBadge>
                  </div>
                  <p class="text-sm text-muted">{{ $t('admin.apis.routing.serviceControl.configurationDescription') }}</p>
                </div>
                <UButton
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-refresh-cw"
                  :disabled="controls.synchronizationDisabled"
                  :loading="controls.synchronizing"
                  @click="synchronizeConfiguration"
                >{{ $t('admin.apis.routing.serviceControl.syncAllTargets') }}</UButton>
              </div>
              <p class="flex items-start gap-2 text-xs leading-5 text-muted">
                <UIcon name="i-lucide-shield-check" class="mt-0.5 size-4 shrink-0" />
                {{ $t('admin.apis.routing.serviceControl.secretBoundaryDescription') }}
              </p>
              <AdminServiceConfigurationForm
                v-if="view.definition?.groups.length"
                :view="view"
                :loading="controls.saving"
                :disabled="controls.configurationDisabled"
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
                <UButton :loading="controls.discovering" :disabled="controls.discoverDisabled" @click="discover">
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
                    :disabled="!managementUpstream || targetState.disabled"
                    @click="openTarget()"
                  >{{ $t('admin.apis.routing.actions.addTarget') }}</UButton>
                </div>
              </template>
              <div class="divide-y divide-default">
                <div
                  v-for="target in view.targets"
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
                        :disabled="targetState.disabled"
                        :aria-label="$t('common.actions.more')"
                      />
                    </UDropdownMenu>
                  </div>
                </div>
              </div>
              <UEmpty v-if="view.targets.length === 0" icon="i-lucide-server-off" :title="$t('admin.apis.routing.empty.targetsTitle')" />
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
                  <dd class="mt-1 break-all font-mono text-sm text-highlighted">{{ view.connection.serviceId || '—' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted">{{ $t('admin.apis.routing.serviceControl.lastDiscovered') }}</dt>
                  <dd class="mt-1 text-sm text-highlighted">{{ formatPlatformDate(view.connection.lastDiscoveredAt, locale) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-muted">{{ $t('admin.apis.routing.serviceControl.desiredRevision') }}</dt>
                  <dd class="mt-1 text-sm text-highlighted">{{ desiredRevisionLabel(view.connection.configurationRevision) }}</dd>
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
                      :disabled="controls.tokenInputDisabled"
                      class="min-w-0 flex-1 font-mono"
                    />
                    <UButton
                      type="submit"
                      color="neutral"
                      variant="outline"
                      :loading="controls.updatingToken"
                      :disabled="controls.tokenUpdateDisabled"
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
      :saving="targetState.saving"
      :disabled="targetState.disabled"
      :save="targetOperations.save"
    />
  </div>
</template>
