<script setup lang="ts">
import {
  useAdminUsersDisplayMeta,
  useAdminUsersPage,
  type AdminUserItem
} from '~/composables/admin/use-admin-users-page'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { useDashboardColumnVisibility } from '~/composables/dashboard/use-dashboard-column-visibility'

const { t, locale } = useI18n()
useHead({ title: () => t('admin.users.title') })

const {
  keyword,
  userIdFilter,
  roleFilter,
  activeFilter,
  banFilter,
  creditBalanceFilter,
  activeFilterCount,
  applyFilters,
  resetFilters,
  page,
  pageSize,
  total,
  loading,
  items,
  refresh,
  deleteUser,
  banUser,
  unbanUser,
  updateUser,
  createUser
} = useAdminUsersPage()

const confirm = useConfirmDialog()

async function openDelete(item: AdminUserItem) {
  await confirm({
    title: t('admin.users.delete.title', { username: item.username }),
    description: t('admin.users.delete.description'),
    onConfirm: async () => {
      const ok = await deleteUser(item.id)
      if (!ok) throw new Error('delete failed')
    }
  })
}

const banOpen = ref(false)
const banTarget = ref<AdminUserItem | null>(null)

function openBan(item: AdminUserItem) {
  banTarget.value = item
  banOpen.value = true
}

async function openUnban(item: AdminUserItem) {
  await confirm({
    title: t('admin.users.unban.title', { username: item.username }),
    description: t('admin.users.unban.description'),
    onConfirm: async () => {
      const ok = await unbanUser(item)
      if (!ok) throw new Error('unban failed')
    }
  })
}

const editOpen = ref(false)
const editTarget = ref<AdminUserItem | null>(null)

function openEdit(item: AdminUserItem) {
  editTarget.value = item
  editOpen.value = true
}

const createOpen = ref(false)

const keysOpen = ref(false)
const keysTarget = ref<AdminUserItem | null>(null)

function openKeys(item: AdminUserItem) {
  keysTarget.value = item
  keysOpen.value = true
}

const creditOpen = ref(false)
const creditUserIds = ref<number[]>([])
const creditSelectionLabel = ref('')

function formatCreditTarget(item: AdminUserItem) {
  return t('admin.users.selection.creditTarget', {
    username: item.username,
    id: item.id
  })
}

function openCreditModal(userIds: number[], selectionLabel: string) {
  creditUserIds.value = userIds
  creditSelectionLabel.value = selectionLabel
  creditOpen.value = true
}

function openCreditForUser(item: AdminUserItem) {
  openCreditModal([item.id], formatCreditTarget(item))
}

const {
  roleFilterOptions,
  activeFilterOptions,
  banFilterOptions,
  creditBalanceFilterOptions,
  columns,
  banTooltip,
  getRowItems
} = useAdminUsersDisplayMeta({
  openEdit,
  openBan,
  openUnban,
  openCredits: openCreditForUser,
  openKeys,
  openDelete
})

const { columnVisibility, columnVisibilityItems } = useDashboardColumnVisibility(columns)
columnVisibility.value = {
  displayName: false,
  isBanned: false,
  createdAt: false
}

const rowSelection = ref<Record<string, boolean>>({})
const selectedUsers = computed(() => items.value.filter(item => rowSelection.value[String(item.id)]))
const selectedCount = computed(() => selectedUsers.value.length)

function clearSelection() {
  rowSelection.value = {}
}

function openCreditForSelection() {
  const selected = selectedUsers.value
  const firstSelected = selected[0]
  if (!firstSelected) return

  openCreditModal(
    selected.map(item => item.id),
    selected.length === 1
      ? formatCreditTarget(firstSelected)
      : t('admin.users.selection.selectedCount', { count: selected.length })
  )
}

async function onCreditSaved() {
  clearSelection()
  await refresh()
}

watch(loading, (isLoading) => {
  if (isLoading) clearSelection()
})
</script>

<template>
  <UDashboardPanel id="admin-users">
    <template #header>
      <DashboardPageNavbar :title="$t('admin.users.title')" />
    </template>

    <template #body>
      <div class="dashboard-section-page space-y-6">
        <div class="flex items-center gap-2 flex-wrap">
          <AdminFilterPopover
            :active-count="activeFilterCount"
            :title="$t('admin.users.filterTitle')"
            @apply="applyFilters"
            @reset="resetFilters"
          >
            <UFormField :label="$t('common.filters.keyword')">
              <UInput
                v-model="keyword"
                :placeholder="$t('admin.users.searchPlaceholder')"
                class="w-full"
              />
            </UFormField>
            <UFormField
              :label="$t('admin.users.filters.userId')"
              :hint="$t('admin.users.filters.exactMatch')"
            >
              <UInput
                v-model.number="userIdFilter"
                type="number"
                inputmode="numeric"
                :min="1"
                :step="1"
                :placeholder="$t('admin.users.filters.userIdPlaceholder')"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('admin.users.filters.role')">
              <USelect
                v-model="roleFilter"
                :items="roleFilterOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('admin.users.filters.activeStatus')">
              <USelect
                v-model="activeFilter"
                :items="activeFilterOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('admin.users.filters.banStatus')">
              <USelect
                v-model="banFilter"
                :items="banFilterOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('admin.users.filters.creditBalance')">
              <USelect
                v-model="creditBalanceFilter"
                :items="creditBalanceFilterOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </AdminFilterPopover>
          <div class="ml-auto flex items-center gap-2 flex-wrap">
            <UButton
              color="primary"
              icon="i-mdi-account-plus-outline"
              @click="() => { createOpen = true }"
            >
              {{ $t('admin.users.actions.add') }}
            </UButton>
            <UDropdownMenu
              :items="columnVisibilityItems"
              :content="{ align: 'end' }"
            >
              <UButton
                :label="$t('admin.users.actions.showColumns')"
                color="neutral"
                variant="outline"
                icon="i-mdi-view-column-outline"
              />
            </UDropdownMenu>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-refresh-cw"
              :loading="loading"
              @click="() => refresh()"
            >
              {{ $t('common.actions.refresh') }}
            </UButton>
          </div>
        </div>

        <DashboardTableCard
          :title="$t('admin.users.listTitle')"
          icon="i-mdi-account-group-outline"
        >
          <template #actions>
            <div class="flex flex-wrap items-center justify-end gap-2">
              <span class="text-xs text-muted tabular-nums">
                {{ $t('admin.users.selection.selectedCount', { count: selectedCount }) }}
              </span>
              <UButton
                v-if="selectedCount > 0"
                :label="$t('admin.users.actions.batchAdjustCredits')"
                icon="i-mdi-cash-edit"
                size="xs"
                @click="openCreditForSelection"
              />
              <UButton
                v-if="selectedCount > 0"
                :label="$t('admin.users.selection.clear')"
                color="neutral"
                variant="ghost"
                size="xs"
                @click="clearSelection"
              />
            </div>
          </template>

          <DashboardDataTable
            v-model:page="page"
            v-model:page-size="pageSize"
            v-model:row-selection="rowSelection"
            v-model:column-visibility="columnVisibility"
            :data="items"
            :columns="columns"
            :loading="loading"
            :total="total"
            :page-size-options="PAGE_SIZE_OPTIONS"
            :get-row-id="(row: AdminUserItem) => String(row.id)"
            :fixed="false"
            :empty-title="$t('admin.users.empty')"
            empty-icon="i-mdi-account-off-outline"
          >
            <template #select-header="{ table }">
              <UCheckbox
                :model-value="table.getIsSomePageRowsSelected() ? 'indeterminate' : table.getIsAllPageRowsSelected()"
                :aria-label="$t('admin.users.selection.selectAll')"
                @update:model-value="(value: boolean | 'indeterminate') => table.toggleAllPageRowsSelected(value === true)"
              />
            </template>
            <template #select-cell="{ row }">
              <UCheckbox
                :model-value="row.getIsSelected()"
                :aria-label="$t('admin.users.selection.selectUser', { username: row.original.username })"
                @update:model-value="(value: boolean | 'indeterminate') => row.toggleSelected(value === true)"
              />
            </template>
            <template #id-cell="{ row }">
              <span class="font-mono tabular-nums text-toned">{{ row.original.id }}</span>
            </template>
            <template #email-cell="{ row }">
              <span :class="row.original.email ? 'text-default' : 'text-muted'">
                {{ row.original.email || '—' }}
              </span>
            </template>
            <template #displayName-cell="{ row }">
              <span :class="row.original.displayName ? 'text-default' : 'text-muted'">
                {{ row.original.displayName || '—' }}
              </span>
            </template>
            <template #credits-cell="{ row }">
              <UBadge
                :color="row.original.credits > 0 ? 'success' : 'neutral'"
                variant="subtle"
                class="tabular-nums font-mono"
              >
                {{ row.original.credits.toLocaleString(locale) }}
              </UBadge>
            </template>
            <template #role-cell="{ row }">
              <UBadge
                color="neutral"
                variant="subtle"
              >
                {{ row.original.role === 'admin' ? $t('common.identities.admin') : $t('common.identities.user') }}
              </UBadge>
            </template>
            <template #isActive-cell="{ row }">
              <UBadge
                :color="row.original.isActive ? 'success' : 'neutral'"
                variant="subtle"
              >
                {{ row.original.isActive ? $t('common.accounts.active') : $t('common.accounts.inactive') }}
              </UBadge>
            </template>
            <template #isBanned-cell="{ row }">
              <UTooltip
                v-if="row.original.isBanned"
                :text="banTooltip(row.original)"
                :content="{ side: 'top' }"
              >
                <UBadge
                  color="error"
                  variant="subtle"
                  :icon="row.original.bannedUntil ? 'i-mdi-clock-alert-outline' : 'i-mdi-lock'"
                >
                  {{ row.original.bannedUntil
                    ? $t('common.accounts.bannedUntil', {
                      time: formatDateTime(row.original.bannedUntil, '-', locale)
                    })
                    : $t('common.accounts.permanentBan') }}
                </UBadge>
              </UTooltip>
              <UBadge
                v-else
                color="success"
                variant="subtle"
              >
                {{ $t('common.accounts.unbanned') }}
              </UBadge>
            </template>
            <template #createdAt-cell="{ row }">
              {{ formatDateTime(row.original.createdAt, '-', locale) }}
            </template>
            <template #actions-cell="{ row }">
              <div class="text-right">
                <UDropdownMenu
                  :items="getRowItems(row.original)"
                  :content="{ align: 'end' }"
                >
                  <UButton
                    icon="i-mdi-dots-vertical"
                    :aria-label="$t('admin.users.actions.more', { name: row.original.username || row.original.email || row.original.id })"
                    color="neutral"
                    variant="ghost"
                  />
                </UDropdownMenu>
              </div>
            </template>
          </DashboardDataTable>
        </DashboardTableCard>

        <LazyAdminUserEditModal
          v-if="editOpen"
          v-model:open="editOpen"
          :target="editTarget"
          :on-submit="updateUser"
        />

        <LazyAdminUserBanModal
          v-if="banOpen"
          v-model:open="banOpen"
          :target="banTarget"
          :on-submit="banUser"
        />

        <LazyAdminUserCreateModal
          v-if="createOpen"
          v-model:open="createOpen"
          :on-submit="createUser"
        />

        <LazyAdminUserKeysModal
          v-if="keysOpen"
          v-model:open="keysOpen"
          :target="keysTarget"
        />

        <LazyAdminCreditModal
          v-if="creditOpen"
          v-model:open="creditOpen"
          :user-ids="creditUserIds"
          :selection-label="creditSelectionLabel"
          @saved="onCreditSaved"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
