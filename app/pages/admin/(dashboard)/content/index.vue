<script setup lang="ts">
import { MESSAGE_LEVELS, type Announcement, type MessageLevel } from '#shared/types/content'
import type { TableColumn, DropdownMenuItem } from '@nuxt/ui'
import { MESSAGE_LEVEL_META as levelMeta } from '~/constants/message-level'
import { parseFetchError } from '~/utils/client-error'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { useClientPagination } from '~/composables/dashboard/use-client-pagination'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'

interface AnnouncementFilterOption<TValue extends string = string> {
  label: string
  value: TValue
}

type AnnouncementLevelFilter = 'all' | MessageLevel
type AnnouncementStatusFilter = 'all' | 'enabled' | 'disabled'
type AnnouncementPinnedFilter = 'all' | 'pinned' | 'normal'

const toast = useToast()
const confirm = useConfirmDialog()
const { t, locale } = useI18n()

const { data, loading, refresh } = usePrivateResource<Announcement[]>({
  path: '/api/admin/announcements/list',
  defaultData: () => []
})

const keyword = ref('')
const levelFilter = ref<AnnouncementLevelFilter>('all')
const statusFilter = ref<AnnouncementStatusFilter>('all')
const pinnedFilter = ref<AnnouncementPinnedFilter>('all')

const levelFilterOptions = computed<Array<AnnouncementFilterOption<AnnouncementLevelFilter>>>(() => [
  { label: t('admin.content.announcements.filters.allLevels'), value: 'all' },
  ...MESSAGE_LEVELS.map(level => ({
    label: t(`admin.content.announcements.levels.${level}`),
    value: level
  }))
])
const statusFilterOptions = computed<Array<AnnouncementFilterOption<AnnouncementStatusFilter>>>(() => [
  { label: t('admin.content.announcements.filters.allStatuses'), value: 'all' },
  { label: t('admin.content.announcements.filters.enabled'), value: 'enabled' },
  { label: t('admin.content.announcements.filters.disabled'), value: 'disabled' }
])
const pinnedFilterOptions = computed<Array<AnnouncementFilterOption<AnnouncementPinnedFilter>>>(() => [
  { label: t('admin.content.announcements.filters.allPinned'), value: 'all' },
  { label: t('admin.content.announcements.filters.pinned'), value: 'pinned' },
  { label: t('admin.content.announcements.filters.notPinned'), value: 'normal' }
])
const activeFilterCount = computed(() => [
  keyword.value.trim().length > 0,
  levelFilter.value !== 'all',
  statusFilter.value !== 'all',
  pinnedFilter.value !== 'all'
].filter(Boolean).length)

const filteredData = computed(() => data.value.filter(item => isAnnouncementVisible(item)))
const { page, pageSize, total, paginated } = useClientPagination(filteredData)

const modalOpen = ref(false)
const editItem = ref<Announcement | null>(null)

watch([keyword, levelFilter, statusFilter, pinnedFilter], () => {
  page.value = 1
})

function isAnnouncementVisible(item: Announcement): boolean {
  const normalizedKeyword = keyword.value.trim().toLowerCase()
  const matchesKeyword = !normalizedKeyword
    || item.title.toLowerCase().includes(normalizedKeyword)
    || item.content.toLowerCase().includes(normalizedKeyword)
    || (item.linkUrl || '').toLowerCase().includes(normalizedKeyword)
  const matchesLevel = levelFilter.value === 'all' || item.level === levelFilter.value
  const matchesStatus = statusFilter.value === 'all'
    || (statusFilter.value === 'enabled' && item.isEnabled)
    || (statusFilter.value === 'disabled' && !item.isEnabled)
  const matchesPinned = pinnedFilter.value === 'all'
    || (pinnedFilter.value === 'pinned' && item.isPinned)
    || (pinnedFilter.value === 'normal' && !item.isPinned)

  return matchesKeyword && matchesLevel && matchesStatus && matchesPinned
}

function resetFilters() {
  keyword.value = ''
  levelFilter.value = 'all'
  statusFilter.value = 'all'
  pinnedFilter.value = 'all'
}

function openAdd() {
  editItem.value = null
  modalOpen.value = true
}
function openEdit(item: Announcement) {
  editItem.value = item
  modalOpen.value = true
}
async function openDelete(item: Announcement) {
  await confirm({
    title: t('admin.content.announcements.delete.title', { title: item.title }),
    description: t('admin.content.announcements.delete.description'),
    onConfirm: async () => {
      try {
        await $fetch('/api/admin/announcements/delete', {
          method: 'POST',
          body: { id: item.id }
        })
        toast.add({ title: t('common.feedback.deleted'), color: 'success' })
        await refresh()
      } catch (err: unknown) {
        toast.add({ title: parseFetchError(err, t('common.feedback.deleteFailed')), color: 'error' })
        throw err
      }
    }
  })
}

async function quickToggle(row: Announcement, field: 'isEnabled' | 'isPinned', value: boolean) {
  try {
    await $fetch('/api/admin/announcements/update', {
      method: 'PUT',
      body: { id: row.id, [field]: value }
    })
    await refresh()
  } catch (err: unknown) {
    toast.add({ title: parseFetchError(err, t('common.feedback.operationFailed')), color: 'error' })
  }
}

function getRowItems(row: Announcement): DropdownMenuItem[] {
  return [
    { label: t('common.actions.edit'), icon: 'i-mdi-pencil-outline', onSelect: () => openEdit(row) },
    { label: t('common.actions.delete'), icon: 'i-mdi-delete-outline', color: 'error' as const, onSelect: () => openDelete(row) }
  ]
}

const columns = computed<TableColumn<Announcement>[]>(() => [
  { accessorKey: 'title', header: t('admin.content.announcements.columns.title') },
  { accessorKey: 'sortOrder', header: t('admin.content.announcements.columns.sortOrder') },
  { id: 'isEnabled', header: t('admin.content.announcements.columns.enabled') },
  { id: 'isPinned', header: t('admin.content.announcements.columns.pinned') },
  { accessorKey: 'createdAt', header: t('admin.content.announcements.columns.createdAt') },
  { id: 'actions', header: '' }
])
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-2">
      <AdminFilterPopover
        :active-count="activeFilterCount"
        @reset="resetFilters"
      >
        <UFormField :label="$t('common.filters.keyword')">
          <UInput
            v-model="keyword"
            :placeholder="$t('admin.content.announcements.searchPlaceholder')"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('admin.content.announcements.filters.level')">
          <USelect
            v-model="levelFilter"
            :items="levelFilterOptions"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('admin.content.announcements.filters.status')">
          <USelect
            v-model="statusFilter"
            :items="statusFilterOptions"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('admin.content.announcements.filters.pinnedState')">
          <USelect
            v-model="pinnedFilter"
            :items="pinnedFilterOptions"
            class="w-full"
          />
        </UFormField>
      </AdminFilterPopover>
      <div class="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
        <UButton
          icon="i-mdi-plus"
          @click="openAdd"
        >
          {{ $t('admin.content.announcements.actions.create') }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          @click="refresh()"
        >
          {{ $t('common.actions.refresh') }}
        </UButton>
      </div>
    </div>

    <DashboardTableCard
      :title="$t('admin.content.announcements.listTitle')"
      icon="i-mdi-bullhorn-outline"
    >
      <DashboardDataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :data="paginated"
        :columns="columns"
        :loading="loading"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :empty-title="$t('admin.content.announcements.empty')"
        empty-icon="i-mdi-bullhorn-outline"
      >
        <template #title-cell="{ row }">
          <div class="flex items-center gap-2">
            <UBadge
              :color="levelMeta[row.original.level].color"
              variant="subtle"
            >
              {{ $t(`admin.content.announcements.levels.${row.original.level}`) }}
            </UBadge>
            <span class="font-medium truncate max-w-[300px]">{{ row.original.title }}</span>
            <UBadge
              v-if="row.original.isPinned"
              color="warning"
              variant="soft"
            >
              {{ $t('admin.content.announcements.pinnedBadge') }}
            </UBadge>
          </div>
        </template>
        <template #isEnabled-cell="{ row }">
          <USwitch
            :model-value="row.original.isEnabled"
            @update:model-value="(val: boolean) => quickToggle(row.original, 'isEnabled', val)"
          />
        </template>
        <template #isPinned-cell="{ row }">
          <USwitch
            :model-value="row.original.isPinned"
            @update:model-value="(val: boolean) => quickToggle(row.original, 'isPinned', val)"
          />
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-xs text-muted">{{ formatDateTime(row.original.createdAt, '-', locale) }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="text-right">
            <UDropdownMenu
              :items="getRowItems(row.original)"
              :content="{ align: 'end' }"
            >
              <UButton
                icon="i-mdi-dots-vertical"
                :aria-label="$t('admin.content.announcements.actions.more', { title: row.original.title })"
                color="neutral"
                variant="ghost"
                size="sm"
              />
            </UDropdownMenu>
          </div>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>

    <LazyAdminAnnouncementModal
      v-if="modalOpen"
      v-model:open="modalOpen"
      :item="editItem"
      @saved="refresh()"
    />
  </div>
</template>
