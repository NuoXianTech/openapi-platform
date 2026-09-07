<script setup lang="ts">
import type {
  PlatformEndpointCatalogItem,
  PlatformEndpointCatalogService,
  PlatformEndpointPublicationPatch
} from '#shared/types/platform'
import {
  platformStatusColor,
  serviceAvailabilityColor
} from '~/utils/platform-display'
import type { EndpointFeedback } from '~/composables/admin/use-admin-endpoint-catalog-page'

const props = defineProps<{
  service: PlatformEndpointCatalogService
  isBusy: (key: string) => boolean
  feedback: Record<string, EndpointFeedback>
  selectedKeys: Set<string>
  selectableKeys: Set<string>
  selectionDisabled: boolean
}>()

const emit = defineEmits<{
  discover: [upstreamId: string]
  edit: [item: PlatformEndpointCatalogItem]
  manual: [upstreamId: string]
  remove: [item: PlatformEndpointCatalogItem]
  select: [keys: string[], selected: boolean]
  primary: [
    service: PlatformEndpointCatalogService,
    item: PlatformEndpointCatalogItem
  ]
  update: [
    item: PlatformEndpointCatalogItem,
    patch: PlatformEndpointPublicationPatch,
    successKey: string
  ]
}>()

const { t } = useI18n()
const route = useRoute()
const serviceSelectableKeys = computed(() => props.service.endpoints
  .filter(item => props.selectableKeys.has(item.key))
  .map(item => item.key))
const serviceSelectionState = computed(() => {
  const count = serviceSelectableKeys.value.filter(key => props.selectedKeys.has(key)).length
  return count === 0 ? false : count === serviceSelectableKeys.value.length ? true : 'indeterminate'
})

function serviceName() {
  return props.service.upstream.connection?.serviceName
    ?? props.service.upstream.name
}

function serviceStateColor() {
  const upstream = props.service.upstream
  if (upstream.status !== 'active' || !upstream.serviceManaged) {
    return platformStatusColor(upstream.status)
  }
  if (!upstream.connection?.discovered) return 'warning' as const
  return serviceAvailabilityColor(upstream.connection.availability)
}

function serviceStateLabel() {
  const upstream = props.service.upstream
  if (upstream.status !== 'active') {
    return t(`admin.apis.routing.serviceStatuses.${upstream.status}`)
  }
  if (!upstream.serviceManaged) {
    return t('admin.apis.routing.serviceControl.enabled')
  }
  if (!upstream.connection?.discovered) {
    return t('admin.apis.routing.serviceControl.notDiscovered')
  }
  return t(
    `admin.apis.routing.serviceControl.availability.${upstream.connection.availability}`
  )
}

function endpointBusy(item: PlatformEndpointCatalogItem) {
  return props.isBusy(`endpoint:${item.key}`)
    || props.isBusy('apply:runtime')
    || props.isBusy('bulk:endpoints')
}

function itemFeedback(item: PlatformEndpointCatalogItem) {
  return props.feedback[item.route?.route.id ?? item.key]
}

function itemMethod(item: PlatformEndpointCatalogItem) {
  return item.endpoint?.method ?? item.route?.route.method ?? 'GET'
}

function sourcePath(item: PlatformEndpointCatalogItem) {
  return item.endpoint?.path ?? item.route?.route.upstreamPathTemplate ?? '—'
}

function publicPath(item: PlatformEndpointCatalogItem) {
  return item.route?.route.pathPattern ?? item.endpoint?.path ?? '—'
}

function itemSummary(item: PlatformEndpointCatalogItem) {
  if (item.sourceKind === 'missing') {
    return t('admin.apis.routing.catalog.contractMissing')
  }
  if (item.sourceKind === 'manual') {
    return item.route?.route.name
      ?? t('admin.apis.routing.catalog.manualRoute')
  }
  return item.endpoint?.summary
    ?? item.endpoint?.operationId
    ?? item.route?.route.name
    ?? '—'
}

function statusColor(status: PlatformEndpointCatalogItem['status']) {
  if (status === 'live') return 'success' as const
  if (status === 'pending' || status === 'retiring') return 'warning' as const
  if (status === 'available') return 'info' as const
  return 'neutral' as const
}

function primaryActionLabel(item: PlatformEndpointCatalogItem) {
  if (item.status === 'live') {
    return t('admin.apis.routing.catalog.actions.unpublish')
  }
  if (item.status === 'disabled') {
    return t('common.actions.enable')
  }
  if (item.status === 'pending') {
    return t('admin.apis.routing.catalog.actions.pendingApply')
  }
  if (item.status === 'retiring') {
    return t('admin.apis.routing.catalog.actions.pendingApply')
  }
  return t('admin.apis.routing.catalog.actions.publish')
}

function primaryActionIcon(item: PlatformEndpointCatalogItem) {
  if (item.status === 'live') return 'i-lucide-power'
  if (item.status === 'pending' || item.status === 'retiring') {
    return 'i-lucide-clock-3'
  }
  return 'i-lucide-rocket'
}

function primaryActionColor(item: PlatformEndpointCatalogItem) {
  if (item.status === 'live') return 'neutral' as const
  if (item.status === 'pending' || item.status === 'retiring') {
    return 'warning' as const
  }
  return 'primary' as const
}

function toggleStatistics(item: PlatformEndpointCatalogItem) {
  const binding = item.route
  if (!binding) return
  emit(
    'update',
    item,
    { isStatistics: !binding.route.isStatistics },
    binding.route.isStatistics
      ? 'admin.apis.routing.catalog.feedback.statisticsDisabled'
      : 'admin.apis.routing.catalog.feedback.statisticsEnabled'
  )
}

function toggleApiKey(item: PlatformEndpointCatalogItem) {
  const binding = item.route
  if (!binding) return
  emit(
    'update',
    item,
    { isApiKey: !binding.route.isApiKey },
    binding.route.isApiKey
      ? 'admin.apis.routing.catalog.feedback.apiKeyDisabled'
      : 'admin.apis.routing.catalog.feedback.apiKeyEnabled'
  )
}
</script>

<template>
  <section
    class="endpoint-service min-w-0"
    :aria-label="serviceName()"
  >
    <div class="flex flex-col gap-3 border-b border-default py-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted">
          <UIcon
            :name="service.upstream.serviceManaged ? 'i-lucide-server' : 'i-lucide-globe-2'"
            class="size-5"
          />
        </div>
        <div class="min-w-0">
          <h2 class="break-words text-sm font-semibold text-highlighted">
            {{ serviceName() }}
          </h2>
          <p class="mt-1 break-all font-mono text-xs text-muted">
            {{ service.upstream.connection?.serviceId || service.upstream.slug }}
            <template v-if="service.upstream.connection?.serviceVersion">
              · {{ service.upstream.connection.serviceVersion }}
            </template>
            · {{ $t('admin.apis.routing.catalog.endpointCount', { count: service.endpoints.length }) }}
          </p>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2 sm:justify-end">
        <UBadge
          :color="serviceStateColor()"
          variant="subtle"
          size="sm"
        >
          {{ serviceStateLabel() }}
        </UBadge>
        <UButton
          v-if="service.upstream.serviceManaged"
          :to="{ path: `/admin/apis/upstreams/${service.upstream.id}`, query: route.query }"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-sliders-horizontal"
        >
          {{ $t('admin.apis.routing.catalog.actions.serviceSettings') }}
        </UButton>
        <UButton
          v-if="service.upstream.serviceManaged"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-scan-search"
          :loading="isBusy(`discover:${service.upstream.id}`)"
          :disabled="selectionDisabled"
          @click="emit('discover', service.upstream.id)"
        >
          {{ $t('admin.apis.routing.catalog.actions.rediscover') }}
        </UButton>
      </div>
    </div>

    <template
      v-if="service.endpoints.length"
    >
      <div class="endpoint-entry endpoint-heading border-b border-default bg-muted/50 text-xs font-medium text-muted">
        <UCheckbox
          :model-value="serviceSelectionState"
          :disabled="serviceSelectableKeys.length === 0 || selectionDisabled"
          :aria-label="$t('admin.apis.routing.catalog.bulk.selectService', { name: serviceName() })"
          @update:model-value="emit('select', serviceSelectableKeys, $event === true)"
        />
        <div class="endpoint-grid">
          <span>{{ $t('admin.apis.routing.catalog.columns.endpoint') }}</span>
          <span class="endpoint-column-label">{{ $t('admin.apis.routing.catalog.columns.status') }}</span>
          <span class="endpoint-column-label">{{ $t('admin.apis.routing.catalog.columns.settings') }}</span>
          <span class="endpoint-column-label text-end">{{ $t('admin.apis.routing.catalog.columns.actions') }}</span>
        </div>
      </div>
      <ul class="divide-y divide-default">
        <li
          v-for="item in service.endpoints"
          :key="item.key"
          class="endpoint-entry transition-colors hover:bg-muted/40"
          :class="{ 'bg-muted/60': selectedKeys.has(item.key) }"
        >
          <UCheckbox
            class="mt-0.5"
            :model-value="selectedKeys.has(item.key)"
            :disabled="!selectableKeys.has(item.key) || selectionDisabled"
            :aria-label="$t('admin.apis.routing.catalog.bulk.selectEndpoint', { method: itemMethod(item), path: publicPath(item) })"
            @update:model-value="emit('select', [item.key], $event === true)"
          />
          <div class="endpoint-grid endpoint-row">
            <div class="endpoint-detail min-w-0">
              <div class="flex min-w-0 items-start gap-2">
                <ApiHttpMethodBadge
                  :method="item.route?.route.method ?? itemMethod(item)"
                  size="xs"
                  class="mt-0.5 w-14 shrink-0 justify-center"
                />
                <code
                  class="min-w-0 break-all text-[13px] font-semibold leading-5 text-highlighted"
                >
                  {{ publicPath(item) }}
                </code>
              </div>
              <p class="mt-1 text-xs leading-5 text-muted [overflow-wrap:anywhere]">
                {{ itemSummary(item) }}
              </p>
              <p v-if="sourcePath(item) !== publicPath(item)" class="mt-1 flex items-start gap-1 text-xs text-muted">
                <span class="shrink-0">{{ $t('admin.apis.routing.catalog.columns.source') }}</span>
                <code class="min-w-0 break-all">{{ sourcePath(item) }}</code>
              </p>
              <div class="mt-1 min-h-4" role="status" aria-live="polite" aria-atomic="true">
                <p
                v-if="itemFeedback(item)"
                  class="flex items-start gap-1 text-xs leading-4 [overflow-wrap:anywhere]"
                  :class="{
                  'text-success': itemFeedback(item)?.color === 'success',
                  'text-warning': itemFeedback(item)?.color === 'warning',
                  'text-error': itemFeedback(item)?.color === 'error'
                  }"
                >
                  <UIcon
                  :name="itemFeedback(item)?.color === 'error' ? 'i-lucide-circle-alert' : itemFeedback(item)?.color === 'warning' ? 'i-lucide-clock-3' : 'i-lucide-check'"
                    class="size-4 shrink-0"
                  />
                {{ itemFeedback(item)?.message }}
                </p>
              </div>
            </div>

            <div class="endpoint-status flex flex-wrap items-center gap-2">
              <UBadge
                :color="statusColor(item.status)"
                variant="subtle"
                size="sm"
                class="max-w-full whitespace-normal"
              >
                {{ $t(`admin.apis.routing.catalog.statuses.${item.status}`) }}
              </UBadge>
              <span v-if="item.route && item.route.route.creditsCost > 0" class="inline-flex items-center gap-1 text-xs text-muted">
                <UIcon
                  name="i-lucide-coins"
                  class="size-3.5 shrink-0"
                />
                {{ $t('admin.apis.routing.catalog.credits', { value: item.route.route.creditsCost }) }}
              </span>
            </div>

            <div class="endpoint-settings min-w-0">
              <div
                v-if="item.route"
                class="flex flex-wrap gap-x-4 gap-y-2"
              >
                <USwitch
                  size="sm"
                  color="success"
                  :model-value="item.route.route.isStatistics"
                  :disabled="item.route.route.creditsCost > 0 || endpointBusy(item)"
                  :label="$t('admin.apis.routing.catalog.actions.statistics')"
                  :aria-label="$t('admin.apis.routing.catalog.accessibility.statistics', { path: publicPath(item) })"
                  :ui="{ label: 'text-xs' }"
                  @update:model-value="toggleStatistics(item)"
                />
                <USwitch
                  size="sm"
                  color="success"
                  :model-value="item.route.route.isApiKey"
                  :disabled="item.route.route.creditsCost > 0 || endpointBusy(item)"
                  :label="$t('admin.apis.routing.actions.apiKey')"
                  :aria-label="$t('admin.apis.routing.catalog.accessibility.apiKey', { path: publicPath(item) })"
                  :ui="{ label: 'text-xs' }"
                  @update:model-value="toggleApiKey(item)"
                />
              </div>
              <span v-else class="text-xs text-muted">{{ $t('admin.apis.routing.catalog.settingsUnavailable') }}</span>
              <p v-if="item.route && item.route.route.creditsCost > 0" class="mt-1.5 text-xs text-muted">
                {{ $t('admin.apis.routing.catalog.paidSettings') }}
              </p>
            </div>

            <div class="endpoint-actions flex items-center justify-end gap-1">
              <UTooltip
                v-if="item.route?.route.managedBy === 'manual'"
                :text="item.status === 'disabled'
                  ? $t('admin.apis.routing.actions.deleteRoute')
                  : $t('admin.apis.routing.actions.deleteRouteUnavailable')"
                :content="{ side: 'top', sideOffset: 8 }"
                :disable-hoverable-content="true"
                :ui="{ content: 'pointer-events-none' }"
              >
                <UButton
                  color="error"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-trash-2"
                  :disabled="item.status !== 'disabled' || endpointBusy(item)"
                  class="size-8 justify-center"
                  :aria-label="$t('admin.apis.routing.actions.deleteRoute')"
                  @click="emit('remove', item)"
                />
              </UTooltip>
              <UTooltip
                :text="$t('admin.apis.routing.catalog.actions.advancedSettings')"
                :content="{ side: 'top', sideOffset: 8 }"
                :disable-hoverable-content="true"
                :ui="{ content: 'pointer-events-none' }"
              >
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-settings-2"
                  class="size-8 justify-center"
                  :disabled="!item.route || endpointBusy(item)"
                  :aria-label="$t('admin.apis.routing.catalog.actions.advancedSettings')"
                  @click="emit('edit', item)"
                />
              </UTooltip>
              <UButton
                size="sm"
              class="h-8 w-32 shrink-0 justify-center"
                :color="primaryActionColor(item)"
                :variant="item.status === 'live' ? 'outline' : 'solid'"
                :icon="primaryActionIcon(item)"
              :loading="isBusy(`endpoint:${item.key}`)"
              :disabled="!item.publishable || item.status === 'pending' || item.status === 'retiring' || endpointBusy(item)"
                @click="emit('primary', service, item)"
              >
                {{ primaryActionLabel(item) }}
              </UButton>
            </div>
          </div>
        </li>
      </ul>
    </template>

    <div v-else class="px-5 py-8">
      <UEmpty
        :icon="service.upstream.serviceManaged ? 'i-lucide-file-search' : 'i-lucide-route-off'"
        :title="service.upstream.serviceManaged
          ? $t('admin.apis.routing.catalog.empty.serviceTitle')
          : $t('admin.apis.routing.catalog.empty.manualTitle')"
        :description="service.upstream.serviceManaged
          ? $t('admin.apis.routing.catalog.empty.serviceDescription')
          : $t('admin.apis.routing.catalog.empty.manualDescription')"
      >
        <template #actions>
          <UButton
            v-if="service.upstream.serviceManaged"
            size="sm"
            icon="i-lucide-scan-search"
            :loading="isBusy(`discover:${service.upstream.id}`)"
            :disabled="selectionDisabled"
            @click="emit('discover', service.upstream.id)"
          >
            {{ $t('admin.apis.routing.catalog.actions.rediscover') }}
          </UButton>
          <UButton
            v-else
            size="sm"
            icon="i-lucide-plus"
            :disabled="selectionDisabled"
            @click="emit('manual', service.upstream.id)"
          >
            {{ $t('admin.apis.routing.catalog.actions.manualRoute') }}
          </UButton>
        </template>
      </UEmpty>
    </div>
  </section>
</template>

<style scoped>
.endpoint-service {
  container-type: inline-size;
}

.endpoint-grid {
  display: grid;
  min-width: 0;
  gap: 0.75rem 1rem;
}

.endpoint-entry {
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr);
  gap: 0.5rem;
  padding: 0.625rem 0.5rem;
}

.endpoint-heading {
  align-items: center;
  padding-block: 0.625rem;
}

.endpoint-column-label {
  display: none;
}

@container (min-width: 36rem) {
  .endpoint-row {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .endpoint-status {
    justify-content: flex-end;
  }
}

@container (min-width: 56rem) {
  .endpoint-grid {
    grid-template-columns: minmax(0, 1fr) 6.5rem 9rem 13rem;
    align-items: center;
  }

  .endpoint-column-label {
    display: block;
  }

  .endpoint-status {
    justify-content: flex-start;
  }
}
</style>
