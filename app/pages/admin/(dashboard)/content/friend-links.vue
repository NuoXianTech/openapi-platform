<script setup lang="ts">
import type { TableColumn, DropdownMenuItem } from '@nuxt/ui'
import type { FriendLinkItem } from '#shared/types/content'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { useClientPagination } from '~/composables/dashboard/use-client-pagination'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import { parseFetchError } from '~/utils/client-error'

interface FriendLinkFilterOption<TValue extends string = string> {
  label: string
  value: TValue
}

type FriendLinkStatusFilter = 'all' | 'active' | 'inactive'

const toast = useToast()
const confirm = useConfirmDialog()
const { t } = useI18n()

const { data, loading, refresh } = usePrivateResource<FriendLinkItem[]>({
  path: '/api/admin/friend-links/list',
  defaultData: () => []
})

const keyword = ref('')
const statusFilter = ref<FriendLinkStatusFilter>('all')
const statusFilterOptions = computed<Array<FriendLinkFilterOption<FriendLinkStatusFilter>>>(() => [
  { label: t('admin.content.friendLinks.filters.allStatuses'), value: 'all' },
  { label: t('admin.content.friendLinks.statuses.active'), value: 'active' },
  { label: t('admin.content.friendLinks.statuses.inactive'), value: 'inactive' }
])
const activeFilterCount = computed(() => [
  keyword.value.trim().length > 0,
  statusFilter.value !== 'all'
].filter(Boolean).length)

const filteredData = computed(() => data.value.filter(item => isFriendLinkVisible(item)))
const { page, pageSize, total, paginated } = useClientPagination(filteredData)

const modalOpen = ref(false)
const editItem = ref<FriendLinkItem | null>(null)

watch([keyword, statusFilter], () => {
  page.value = 1
})

function isFriendLinkVisible(item: FriendLinkItem): boolean {
  const normalizedKeyword = keyword.value.trim().toLowerCase()
  const matchesKeyword = !normalizedKeyword
    || item.title.toLowerCase().includes(normalizedKeyword)
    || item.url.toLowerCase().includes(normalizedKeyword)
    || (item.description || '').toLowerCase().includes(normalizedKeyword)
  const matchesStatus = statusFilter.value === 'all'
    || (statusFilter.value === 'active' && item.isActive)
    || (statusFilter.value === 'inactive' && !item.isActive)

  return matchesKeyword && matchesStatus
}

function resetFilters() {
  keyword.value = ''
  statusFilter.value = 'all'
}

function openAdd() {
  editItem.value = null
  modalOpen.value = true
}
function openEdit(item: FriendLinkItem) {
  editItem.value = item
  modalOpen.value = true
}
async function openDelete(item: FriendLinkItem) {
  await confirm({
    title: t('admin.content.friendLinks.delete.title', { title: item.title }),
    description: t('admin.content.friendLinks.delete.description'),
    onConfirm: async () => {
      try {
        await $fetch('/api/admin/friend-links/delete', { method: 'POST', body: { id: item.id } })
        toast.add({ title: t('common.feedback.deleted'), color: 'success' })
        await refresh()
      } catch (err: unknown) {
        toast.add({ title: parseFetchError(err, t('common.feedback.deleteFailed')), color: 'error' })
        throw err
      }
    }
  })
}

function getRowItems(row: FriendLinkItem): DropdownMenuItem[] {
  return [
    { label: t('common.actions.edit'), icon: 'i-mdi-pencil-outline', onSelect: () => openEdit(row) },
    { label: t('common.actions.delete'), icon: 'i-mdi-delete-outline', color: 'error' as const, onSelect: () => openDelete(row) }
  ]
}

const columns = computed<TableColumn<FriendLinkItem>[]>(() => [
  { accessorKey: 'title', header: t('admin.content.friendLinks.columns.title') },
  { accessorKey: 'url', header: 'URL' },
  { accessorKey: 'description', header: t('admin.content.friendLinks.columns.description') },
  { accessorKey: 'isActive', header: t('admin.content.friendLinks.columns.status') },
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
            :placeholder="$t('admin.content.friendLinks.searchPlaceholder')"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('admin.content.friendLinks.filters.status')">
          <USelect
            v-model="statusFilter"
            :items="statusFilterOptions"
            class="w-full"
          />
        </UFormField>
      </AdminFilterPopover>
      <div class="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
        <UButton
          icon="i-mdi-plus"
          @click="openAdd"
        >
          {{ $t('admin.content.friendLinks.actions.create') }}
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
      :title="$t('admin.content.friendLinks.listTitle')"
      icon="i-mdi-link-variant"
    >
      <DashboardDataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :data="paginated"
        :columns="columns"
        :loading="loading"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :empty-title="$t('admin.content.friendLinks.empty')"
        empty-icon="i-mdi-link-variant"
      >
        <template #isActive-cell="{ row }">
          <UBadge
            :color="row.original.isActive ? 'success' : 'neutral'"
            variant="subtle"
          >
            {{ row.original.isActive
              ? $t('admin.content.friendLinks.statuses.active')
              : $t('admin.content.friendLinks.statuses.inactive') }}
          </UBadge>
        </template>
        <template #actions-cell="{ row }">
          <div class="text-right">
            <UDropdownMenu
              :items="getRowItems(row.original)"
              :content="{ align: 'end' }"
            >
              <UButton
                icon="i-mdi-dots-vertical"
                :aria-label="$t('admin.content.friendLinks.actions.more', { name: row.original.title })"
                color="neutral"
                variant="ghost"
                size="sm"
              />
            </UDropdownMenu>
          </div>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>

    <LazyAdminLinkModal
      v-if="modalOpen"
      v-model:open="modalOpen"
      :item="editItem"
      @saved="refresh()"
    />
  </div>
</template>
