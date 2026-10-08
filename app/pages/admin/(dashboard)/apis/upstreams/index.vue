<script setup lang="ts">
import { useAdminUpstreamManagement } from '~/composables/admin/use-admin-upstream-management'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import type { PlatformUpstream, PlatformUpstreamTarget } from '#shared/types/platform'
import { parseFetchError } from '~/utils/client-error'
import {
  platformStatusColor,
  serviceAvailabilityColor
} from '~/utils/platform-display'

const { t } = useI18n()
const route = useRoute()
const {
  resource, upstreams, page, pageSize, total, controls,
  modalOpen, editingUpstream, targetModalOpen, targetUpstream, editingTarget, targetState,
  openCreateUpstream, openEditUpstream, openTarget, refresh, saveTarget,
  toggleUpstream, removeUpstream, toggleTarget, removeTarget
} = useAdminUpstreamManagement()

useHead({ title: () => t('admin.apis.routing.sections.upstreamsTitle') })

function loadBalancingLabel(upstream: PlatformUpstream): string {
  return t(`admin.apis.routing.loadBalancing.${upstream.loadBalancing === 'weighted' ? 'weighted' : 'roundRobin'}`)
}

function upstreamStateColor(upstream: PlatformUpstream) {
  if (upstream.status !== 'active') {
    return platformStatusColor(upstream.status)
  }
  if (!upstream.connection?.discovered) return 'warning' as const
  return serviceAvailabilityColor(upstream.connection.availability)
}

function upstreamStateLabel(upstream: PlatformUpstream): string {
  if (upstream.status !== 'active') {
    return t(`admin.apis.routing.serviceStatuses.${upstream.status}`)
  }
  if (!upstream.connection?.discovered) {
    return t('admin.apis.routing.serviceControl.notDiscovered')
  }
  return t(
    `admin.apis.routing.serviceControl.availability.${upstream.connection.availability}`
  )
}

const columns = computed<TableColumn<PlatformUpstream>[]>(() => [
  { id: 'upstream', header: t('admin.apis.routing.columns.upstream') },
  { id: 'targets', header: t('admin.apis.routing.columns.targets') },
  { id: 'loadBalancing', header: t('admin.apis.routing.columns.loadBalancing') },
  { id: 'status', header: t('admin.apis.routing.serviceControl.runtimeStatus') },
  { id: 'actions', header: '' }
])

function upstreamItems(upstream: PlatformUpstream): DropdownMenuItem[][] {
  return [[
    { label: t('common.actions.edit'), icon: 'i-lucide-pencil', disabled: controls.value.disabled, onSelect: () => openEditUpstream(upstream) },
    { label: t('admin.apis.routing.actions.addTarget'), icon: 'i-lucide-plus', disabled: controls.value.disabled, onSelect: () => openTarget(upstream) },
    {
      label: t(upstream.status === 'active' ? 'common.actions.disable' : 'common.actions.enable'),
      icon: upstream.status === 'active' ? 'i-lucide-pause' : 'i-lucide-play',
      disabled: controls.value.disabled,
      onSelect: () => toggleUpstream(upstream)
    }
  ], [
    { label: t('common.actions.delete'), icon: 'i-lucide-trash-2', color: 'error', disabled: controls.value.disabled, onSelect: () => removeUpstream(upstream) }
  ]]
}

function targetItems(upstream: PlatformUpstream, target: PlatformUpstreamTarget): DropdownMenuItem[][] {
  return [[
    { label: t('common.actions.edit'), icon: 'i-lucide-pencil', disabled: controls.value.disabled, onSelect: () => openTarget(upstream, target) },
    {
      label: t(target.enabled ? 'common.actions.disable' : 'common.actions.enable'),
      icon: target.enabled ? 'i-lucide-pause' : 'i-lucide-play',
      disabled: controls.value.disabled,
      onSelect: () => toggleTarget(target)
    },
    { label: t('common.actions.delete'), icon: 'i-lucide-trash-2', color: 'error' as const, disabled: controls.value.disabled, onSelect: () => removeTarget(target) }
  ]]
}
</script>

<template>
  <div class="space-y-6">
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-network"
      :title="$t('admin.apis.routing.upstreamForm.multiServiceTitle')"
      :description="$t('admin.apis.routing.upstreamForm.multiServiceDescription')"
    />

    <UAlert
      v-if="resource.error.value"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="$t('common.feedback.loadFailed')"
      :description="parseFetchError(resource.error.value, $t('common.feedback.loadFailed'))"
    >
      <template #actions>
        <UButton
          color="error"
          variant="soft"
          size="xs"
          :disabled="controls.refreshDisabled"
          @click="refresh"
        >
          {{ $t('common.actions.retry') }}
        </UButton>
      </template>
    </UAlert>

    <DashboardTableCard
      :title="$t('admin.apis.routing.sections.upstreamsTitle')"
      :description="$t('admin.apis.routing.sections.upstreamsDescription')"
      :total="total"
      icon="i-lucide-server-cog"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="resource.loading.value"
          :disabled="controls.refreshDisabled"
          @click="refresh"
        >
          {{ $t('common.actions.refresh') }}
        </UButton>
        <UButton icon="i-lucide-plus" :disabled="controls.disabled" @click="openCreateUpstream">
          {{ $t('admin.apis.routing.actions.createUpstream') }}
        </UButton>
      </template>
      <DashboardDataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :data="upstreams"
        :columns="columns"
        :loading="resource.loading.value"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :fixed="false"
        :empty-title="$t('admin.apis.routing.empty.upstreamsTitle')"
        :empty-description="$t('admin.apis.routing.empty.upstreamsDescription')"
        empty-icon="i-lucide-server-off"
      >
        <template #upstream-cell="{ row }">
          <div class="min-w-48">
            <p class="text-sm font-semibold text-highlighted">
              {{ row.original.name }}
            </p>
            <p class="font-mono text-xs text-muted">
              {{ row.original.slug }}
            </p>
          </div>
        </template>
        <template #targets-cell="{ row }">
          <div class="min-w-72 space-y-1.5">
            <UDropdownMenu
              v-for="target in row.original.targets"
              :key="target.id"
              :items="targetItems(row.original, target)"
            >
              <div
                class="flex cursor-pointer items-center gap-2 rounded-md px-1 py-0.5 hover:bg-elevated"
                :class="target.enabled ? '' : 'opacity-55'"
              >
                <span class="min-w-0 truncate font-mono text-xs text-highlighted">
                  {{ target.baseUrl }}
                </span>
                <UBadge
                  v-if="row.original.loadBalancing === 'weighted'"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                >
                  {{ target.weight }}
                </UBadge>
                <UBadge
                  color="neutral"
                  variant="subtle"
                  size="sm"
                >
                  {{ $t(target.enabled
                    ? 'admin.apis.routing.serviceControl.enabled'
                    : 'common.states.disabled') }}
                </UBadge>
              </div>
            </UDropdownMenu>
          </div>
        </template>
        <template #loadBalancing-cell="{ row }">
          <span class="text-xs text-toned">{{ loadBalancingLabel(row.original) }}</span>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="upstreamStateColor(row.original)" variant="subtle">
            {{ upstreamStateLabel(row.original) }}
          </UBadge>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end gap-1">
            <UButton
              :to="{
                path: `/admin/apis/upstreams/${row.original.id}`,
                query: route.query
              }"
              color="neutral"
              variant="ghost"
              size="xs"
              icon="i-lucide-settings-2"
            >
              {{ $t('admin.apis.routing.serviceControl.manage') }}
            </UButton>
            <UDropdownMenu :items="upstreamItems(row.original)" :content="{ align: 'end' }">
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                size="xs"
                :aria-label="$t('common.actions.more')"
              />
            </UDropdownMenu>
          </div>
        </template>
        <template #empty-actions>
          <UButton
            size="sm"
            icon="i-lucide-plus"
            :disabled="controls.disabled"
            @click="openCreateUpstream"
          >
            {{ $t('admin.apis.routing.actions.createUpstream') }}
          </UButton>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>

    <AdminPlatformUpstreamModal
      v-model:open="modalOpen"
      :upstream="editingUpstream"
      @saved="refresh"
    />
    <AdminPlatformTargetModal
      v-if="targetUpstream"
      v-model:open="targetModalOpen"
      :upstream="targetUpstream"
      :target="editingTarget"
      :saving="targetState.saving"
      :disabled="targetState.disabled"
      :save="saveTarget"
    />
  </div>
</template>
