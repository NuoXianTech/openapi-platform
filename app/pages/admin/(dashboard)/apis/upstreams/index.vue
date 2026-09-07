<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'
import type { PlatformUpstream, PlatformUpstreamTarget } from '#shared/types/platform'
import { parseFetchError } from '~/utils/client-error'
import {
  platformStatusColor,
  serviceAvailabilityColor
} from '~/utils/platform-display'

const { t } = useI18n()
const route = useRoute()
const modalOpen = ref(false)
const editingUpstream = ref<PlatformUpstream | null>(null)
const targetModalOpen = ref(false)
const targetUpstream = ref<PlatformUpstream | null>(null)
const editingTarget = ref<PlatformUpstreamTarget | null>(null)
const toast = useToast()
const confirm = useConfirmDialog()
const busyKeys = ref(new Set<string>())

useHead({ title: () => t('admin.apis.routing.sections.upstreamsTitle') })

const resource = usePrivatePagedList<Record<string, never>, PlatformUpstream>({
  path: '/api/admin/v1/upstreams/paged',
  defaultFilters: {},
  defaultPageSize: PAGE_SIZE_OPTIONS[0]
})
const upstreams = computed(() => resource.items.value)
const page = resource.page
const pageSize = resource.pageSize
const total = resource.total

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

function openCreateUpstream() {
  editingUpstream.value = null
  modalOpen.value = true
}

function openEditUpstream(upstream: PlatformUpstream) {
  editingUpstream.value = upstream
  modalOpen.value = true
}

function openTarget(upstream: PlatformUpstream, target: PlatformUpstreamTarget | null = null) {
  targetUpstream.value = upstream
  editingTarget.value = target
  targetModalOpen.value = true
}

async function refreshUpstreams() {
  await resource.refresh()
  if (targetUpstream.value) {
    targetUpstream.value = upstreams.value.find(item => item.id === targetUpstream.value?.id) ?? null
  }
}

async function updateUpstreamStatus(upstream: PlatformUpstream) {
  await confirm({
    title: t('admin.apis.routing.toggleUpstream.title', { name: upstream.name }),
    description: t('admin.apis.routing.toggleUpstream.description'),
    confirmLabel: t(upstream.status === 'active' ? 'common.actions.disable' : 'common.actions.enable'),
    confirmColor: upstream.status === 'active' ? 'warning' : 'primary',
    onConfirm: async () => {
      const key = `upstream:${upstream.id}:status`
      busyKeys.value = new Set(busyKeys.value).add(key)
      try {
        await $fetch(`/api/admin/v1/upstreams/${upstream.id}`, {
          method: 'PATCH',
          body: { status: upstream.status === 'active' ? 'disabled' : 'active' }
        })
        toast.add({ title: t('common.feedback.updated'), color: 'success' })
        await refreshUpstreams()
      } catch (error: unknown) {
        toast.add({ title: parseFetchError(error, t('common.feedback.operationFailed')), color: 'error' })
        throw error
      } finally {
        const next = new Set(busyKeys.value)
        next.delete(key)
        busyKeys.value = next
      }
    }
  })
}

async function updateTargetStatus(target: PlatformUpstreamTarget) {
  await confirm({
    title: t('admin.apis.routing.toggleTarget.title', { name: target.baseUrl }),
    description: t('admin.apis.routing.toggleTarget.description'),
    confirmLabel: t(target.enabled ? 'common.actions.disable' : 'common.actions.enable'),
    confirmColor: target.enabled ? 'warning' : 'primary',
    onConfirm: async () => {
      const key = `target:${target.id}:status`
      busyKeys.value = new Set(busyKeys.value).add(key)
      try {
        await $fetch(`/api/admin/v1/targets/${target.id}`, {
          method: 'PATCH',
          body: { enabled: !target.enabled }
        })
        toast.add({ title: t('common.feedback.updated'), color: 'success' })
        await refreshUpstreams()
      } catch (error: unknown) {
        toast.add({ title: parseFetchError(error, t('common.feedback.operationFailed')), color: 'error' })
        throw error
      } finally {
        const next = new Set(busyKeys.value)
        next.delete(key)
        busyKeys.value = next
      }
    }
  })
}

async function removeUpstream(upstream: PlatformUpstream) {
  await confirm({
    title: t('admin.apis.routing.deleteUpstream.title', { name: upstream.name }),
    description: t('admin.apis.routing.deleteUpstream.description'),
    confirmColor: 'error',
    onConfirm: async () => {
      try {
        await $fetch(
          `/api/admin/v1/upstreams/${upstream.id}`,
          { method: 'DELETE' }
        )
        toast.add({ title: t('common.feedback.deleted'), color: 'success' })
        await refreshUpstreams()
      } catch (error: unknown) {
        toast.add({ title: parseFetchError(error, t('common.feedback.deleteFailed')), color: 'error' })
        throw error
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
        await refreshUpstreams()
      } catch (error: unknown) {
        toast.add({ title: parseFetchError(error, t('common.feedback.deleteFailed')), color: 'error' })
        throw error
      }
    }
  })
}

function upstreamItems(upstream: PlatformUpstream): DropdownMenuItem[][] {
  return [[
    { label: t('common.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => openEditUpstream(upstream) },
    { label: t('admin.apis.routing.actions.addTarget'), icon: 'i-lucide-plus', onSelect: () => openTarget(upstream) },
    {
      label: t(upstream.status === 'active' ? 'common.actions.disable' : 'common.actions.enable'),
      icon: upstream.status === 'active' ? 'i-lucide-pause' : 'i-lucide-play',
      disabled: busyKeys.value.has(`upstream:${upstream.id}:status`),
      onSelect: () => updateUpstreamStatus(upstream)
    }
  ], [
    { label: t('common.actions.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeUpstream(upstream) }
  ]]
}

function targetItems(upstream: PlatformUpstream, target: PlatformUpstreamTarget): DropdownMenuItem[][] {
  return [[
    { label: t('common.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => openTarget(upstream, target) },
    {
      label: t(target.enabled ? 'common.actions.disable' : 'common.actions.enable'),
      icon: target.enabled ? 'i-lucide-pause' : 'i-lucide-play',
      disabled: busyKeys.value.has(`target:${target.id}:status`),
      onSelect: () => updateTargetStatus(target)
    },
    { label: t('common.actions.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeTarget(target) }
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
          @click="resource.refresh"
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
          @click="resource.refresh"
        >
          {{ $t('common.actions.refresh') }}
        </UButton>
        <UButton icon="i-lucide-plus" @click="openCreateUpstream">
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
      @saved="refreshUpstreams"
    />
    <AdminPlatformTargetModal
      v-if="targetUpstream"
      v-model:open="targetModalOpen"
      :upstream="targetUpstream"
      :target="editingTarget"
      @saved="refreshUpstreams"
    />
  </div>
</template>
