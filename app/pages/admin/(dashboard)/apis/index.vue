<script setup lang="ts">
import { useAdminEndpointCatalogPage } from '~/composables/admin/use-admin-endpoint-catalog-page'
import { parseFetchError } from '~/utils/client-error'

const { t } = useI18n()
const {
  catalog,
  applyChanges,
  applyChangeCount,
  bulkFeedback,
  bulkProgress,
  bulkSetEnabled,
  clearFocusedService,
  canApply,
  discoverAllServices,
  discoverService,
  driftedServices,
  editingRoute,
  endpointFeedback,
  createRouteUpstreamId,
  focusedUpstreamId,
  requiresDiscovery,
  handlePrimaryAction,
  serviceUpstreams,
  isBusy,
  operationBusy,
  loading,
  openCreateRoute,
  openEditRoute,
  removeRoute,
  products,
  refresh,
  resetFilters,
  resourceError,
  routeModalOpen,
  search,
  selectableKeys,
  selectedKeys,
  selectedEnableCount,
  selectedDisableCount,
  selectionState,
  selectEndpoints,
  selectAllEndpoints,
  statusFilter,
  statusItems,
  updatePublication,
  upstreams,
  visibleServices
} = useAdminEndpointCatalogPage()

useHead({ title: () => t('admin.apis.routing.catalog.title') })
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div class="max-w-3xl">
        <h1 class="text-xl font-semibold text-highlighted">
          {{ $t('admin.apis.routing.catalog.title') }}
        </h1>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-if="canApply"
          icon="i-lucide-cloud-upload"
          :loading="isBusy('apply:runtime')"
          :disabled="operationBusy"
          @click="applyChanges"
        >
          {{ $t('admin.apis.routing.catalog.actions.applyAllChanges', { count: applyChangeCount }) }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-plus"
          :disabled="products.length === 0 || upstreams.length === 0 || operationBusy"
          @click="openCreateRoute()"
        >
          {{ $t('admin.apis.routing.catalog.actions.manualRoute') }}
        </UButton>
        <UButton
          icon="i-lucide-scan-search"
          :loading="isBusy('discover:all')"
          :disabled="serviceUpstreams.length === 0 || operationBusy"
          @click="discoverAllServices"
        >
          {{ $t('admin.apis.routing.catalog.actions.syncServices') }}
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="resourceError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="$t('common.feedback.loadFailed')"
      :description="parseFetchError(resourceError, $t('common.feedback.loadFailed'))"
    >
      <template #actions>
        <UButton
          color="error"
          variant="soft"
          size="xs"
          @click="refresh"
        >
          {{ $t('common.actions.retry') }}
        </UButton>
      </template>
    </UAlert>

    <UAlert
      v-if="driftedServices.length > 0"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="$t('admin.apis.routing.catalog.drift.title', {
        count: catalog.totals.driftedTargets
      })"
    >
      <template #description>
        <p>
          {{ requiresDiscovery
            ? $t('admin.apis.routing.catalog.drift.discoveryRequired')
            : $t('admin.apis.routing.catalog.drift.description') }}
        </p>
        <ul class="mt-2 space-y-1">
          <li
            v-for="service in driftedServices"
            :key="service.upstream.id"
            class="text-xs"
          >
            <span class="font-medium">{{ service.upstream.name }}</span>
            <span
              v-for="item in service.targetDrift"
              :key="item.targetId"
              class="ms-2 block break-all font-mono text-muted"
            >
              <template v-if="item.kind === 'address_changed'">
                {{ $t('admin.apis.routing.catalog.drift.addressChanged', {
                  runtime: item.runtimeBaseUrl,
                  desired: item.desiredBaseUrl
                }) }}
              </template>
              <template v-else-if="item.kind === 'unpublished'">
                {{ $t('admin.apis.routing.catalog.drift.unpublished', {
                  desired: item.desiredBaseUrl
                }) }}
              </template>
              <template v-else>
                {{ $t('admin.apis.routing.catalog.drift.withdrawn', {
                  runtime: item.runtimeBaseUrl
                }) }}
              </template>
            </span>
          </li>
        </ul>
      </template>
      <template #actions>
        <UButton
          color="warning"
          variant="soft"
          size="xs"
          icon="i-lucide-scan-search"
          :loading="isBusy('discover:all')"
          :disabled="operationBusy"
          @click="discoverAllServices"
        >
          {{ $t('admin.apis.routing.catalog.actions.syncServices') }}
        </UButton>
      </template>
    </UAlert>

    <div
      class="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-default py-4 sm:grid-cols-4"
    >
      <div class="flex items-baseline justify-between gap-2 sm:block">
        <p class="text-xs font-medium text-muted">
          {{ $t('admin.apis.routing.catalog.metrics.discovered') }}
        </p>
        <p class="mt-1 font-mono text-xl font-semibold text-highlighted">
          {{ catalog.totals.discovered }}
        </p>
      </div>
      <div class="flex items-baseline justify-between gap-2 sm:block">
        <p class="text-xs font-medium text-muted">
          {{ $t('admin.apis.routing.catalog.metrics.live') }}
        </p>
        <p class="mt-1 font-mono text-xl font-semibold text-success">
          {{ catalog.totals.live }}
        </p>
      </div>
      <div class="flex items-baseline justify-between gap-2 sm:block">
        <p class="text-xs font-medium text-muted">
          {{ $t('admin.apis.routing.catalog.metrics.available') }}
        </p>
        <p class="mt-1 font-mono text-xl font-semibold text-highlighted">
          {{ catalog.totals.available }}
        </p>
      </div>
      <div class="flex items-baseline justify-between gap-2 sm:block">
        <p class="text-xs font-medium text-muted">
          {{ $t('admin.apis.routing.catalog.metrics.pending') }}
        </p>
        <p
          class="mt-1 font-mono text-xl font-semibold"
          :class="catalog.totals.pending > 0 ? 'text-warning' : 'text-highlighted'"
        >
          {{ catalog.totals.pending }}
        </p>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        :placeholder="$t('admin.apis.routing.catalog.searchPlaceholder')"
        :aria-label="$t('admin.apis.routing.catalog.searchPlaceholder')"
        :disabled="isBusy('bulk:endpoints')"
        class="min-w-0 basis-full sm:flex-1"
      />
      <USelect
        v-model="statusFilter"
        :items="statusItems"
        value-key="value"
        :aria-label="$t('admin.apis.routing.catalog.columns.status')"
        :disabled="isBusy('bulk:endpoints')"
        class="min-w-0 flex-1 sm:w-44 sm:flex-none"
      />
      <UTooltip :text="$t('common.actions.refresh')" :ui="{ content: 'pointer-events-none' }" :disable-hoverable-content="true">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          :disabled="operationBusy"
          :aria-label="$t('common.actions.refresh')"
          class="size-8 justify-center"
          @click="refresh"
        />
      </UTooltip>
      <UButton
        v-if="focusedUpstreamId"
        color="neutral"
        variant="soft"
        icon="i-lucide-x"
        :disabled="isBusy('bulk:endpoints')"
        @click="clearFocusedService"
      >
        {{ $t('admin.apis.routing.catalog.actions.showAllServices') }}
      </UButton>
    </div>

    <div class="space-y-2">
      <div class="flex min-h-11 flex-wrap items-center gap-x-4 gap-y-2 border-b border-default pb-3">
        <UCheckbox
          :model-value="selectionState"
          :disabled="selectableKeys.size === 0 || operationBusy"
          :label="$t('admin.apis.routing.catalog.bulk.selectAll')"
          @update:model-value="selectAllEndpoints($event === true)"
        />
        <span class="text-xs text-muted">{{ $t('admin.apis.routing.catalog.bulk.selected', { count: selectedKeys.size }) }}</span>
        <div class="flex flex-wrap items-center gap-2 sm:ms-auto">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-check"
            :disabled="selectedEnableCount === 0 || operationBusy"
            @click="bulkSetEnabled(true)"
          >
            {{ $t('admin.apis.routing.catalog.bulk.enable') }}
            <span class="font-mono text-xs tabular-nums">{{ selectedEnableCount }}</span>
          </UButton>
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-power"
            :disabled="selectedDisableCount === 0 || operationBusy"
            @click="bulkSetEnabled(false)"
          >
            {{ $t('admin.apis.routing.catalog.bulk.disable') }}
            <span class="font-mono text-xs tabular-nums">{{ selectedDisableCount }}</span>
          </UButton>
          <UTooltip :text="$t('admin.apis.routing.catalog.bulk.clear')" :ui="{ content: 'pointer-events-none' }" :disable-hoverable-content="true">
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-x"
              class="size-8 justify-center"
              :aria-label="$t('admin.apis.routing.catalog.bulk.clear')"
              :disabled="selectedKeys.size === 0 || operationBusy"
              @click="selectAllEndpoints(false)"
            />
          </UTooltip>
        </div>
      </div>
      <div v-if="isBusy('bulk:endpoints') || bulkFeedback" role="status" aria-live="polite" aria-atomic="true" class="text-xs">
        <p v-if="isBusy('bulk:endpoints')" class="flex items-center gap-1.5 text-muted">
          <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
          {{ $t('admin.apis.routing.catalog.bulk.progress', bulkProgress) }}
        </p>
        <p
          v-else-if="bulkFeedback"
          :class="{ 'text-success': bulkFeedback.color === 'success', 'text-warning': bulkFeedback.color === 'warning', 'text-error': bulkFeedback.color === 'error' }"
        >
          {{ bulkFeedback.message }}
        </p>
      </div>
    </div>

    <div
      v-if="loading && catalog.services.length === 0"
      class="space-y-4"
    >
      <USkeleton
        v-for="index in 2"
        :key="index"
        class="h-56 rounded-md"
      />
    </div>

    <div v-else-if="visibleServices.length" class="space-y-6">
      <AdminPlatformEndpointServiceCard
        v-for="service in visibleServices"
        :key="service.upstream.id"
        :service="service"
        :is-busy="isBusy"
        :feedback="endpointFeedback"
        :selected-keys="selectedKeys"
        :selectable-keys="selectableKeys"
        :selection-disabled="operationBusy"
        @discover="discoverService"
        @edit="openEditRoute"
        @manual="openCreateRoute"
        @primary="handlePrimaryAction"
        @remove="removeRoute"
        @select="selectEndpoints"
        @update="updatePublication"
      />
    </div>

    <UEmpty
      v-else
      icon="i-lucide-waypoints"
      :title="catalog.services.length === 0
        ? $t('admin.apis.routing.catalog.empty.catalogTitle')
        : $t('admin.apis.routing.catalog.empty.filterTitle')"
      :description="catalog.services.length === 0
        ? $t('admin.apis.routing.catalog.empty.catalogDescription')
        : $t('admin.apis.routing.catalog.empty.filterDescription')"
    >
      <template #actions>
        <UButton
          v-if="catalog.services.length === 0"
          to="/admin/apis/upstreams"
          icon="i-lucide-server-cog"
        >
          {{ $t('admin.apis.routing.actions.createUpstream') }}
        </UButton>
        <UButton
          v-else
          color="neutral"
          variant="outline"
          @click="resetFilters"
        >
          {{ $t('admin.apis.routing.catalog.actions.clearFilters') }}
        </UButton>
      </template>
    </UEmpty>

    <AdminPlatformRouteModal
      v-model:open="routeModalOpen"
      :products="products"
      :upstreams="upstreams"
      :route-binding="editingRoute"
      :initial-upstream-id="createRouteUpstreamId"
      @saved="refresh"
    />
  </div>
</template>
