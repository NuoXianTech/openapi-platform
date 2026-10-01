<script setup lang="ts">
import type { MessageLevel } from '#shared/types/content'
import { MESSAGE_LEVEL_META as levelMeta } from '~/constants/message-level'
import { adminModalUi } from '~/utils/admin-modal-ui'
import { parseFetchError } from '~/utils/client-error'
import {
  useAdminNotificationsDisplayMeta,
  type AdminNotificationDeliveryRow,
  type AdminNotificationMessageRow
} from '~/composables/admin/use-admin-notifications-display-meta'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'

interface AdminNotificationFilterOption<TValue extends string = string> {
  label: string
  value: TValue
}

type AdminNotificationAudienceFilter = 'all' | AdminNotificationMessageRow['audience']
type AdminNotificationLevelFilter = 'all' | MessageLevel

interface AdminNotificationHistoryFilters extends Record<string, unknown> {
  keyword: string
  audience: AdminNotificationAudienceFilter
  level: AdminNotificationLevelFilter
}

const toast = useToast()
const { t, locale } = useI18n()
const compactPagination = useMediaQuery('(max-width: 639px)')

const history = usePrivatePagedList<AdminNotificationHistoryFilters, AdminNotificationMessageRow>({
  path: '/api/admin/notifications/list',
  defaultFilters: { keyword: '', audience: 'all', level: 'all' },
  buildQuery: (filters, pagination) => ({
    keyword: filters.keyword.trim() || undefined,
    audience: filters.audience === 'all' ? undefined : filters.audience,
    level: filters.level === 'all' ? undefined : filters.level,
    limit: pagination.limit,
    offset: pagination.offset
  })
})
const historyKeyword = toRef(history.filters, 'keyword')
const historyAudienceFilter = toRef(history.filters, 'audience')
const historyLevelFilter = toRef(history.filters, 'level')
const {
  page,
  pageSize,
  items: messagesData,
  total,
  loading,
  refresh
} = history

const sendModalOpen = ref(false)

function openSendModal(): void {
  sendModalOpen.value = true
}

const {
  audienceOptions,
  levelOptions,
  getAudienceMeta,
  columns,
  getRowItems
} = useAdminNotificationsDisplayMeta({
  openDetail,
  openDelete
})

const historyAudienceFilterOptions = computed<Array<AdminNotificationFilterOption<AdminNotificationAudienceFilter>>>(() => [
  { label: t('admin.content.notifications.filters.allAudiences'), value: 'all' },
  ...audienceOptions.value
])
const historyLevelFilterOptions = computed<Array<AdminNotificationFilterOption<AdminNotificationLevelFilter>>>(() => [
  { label: t('admin.content.notifications.filters.allLevels'), value: 'all' },
  ...levelOptions.value
])
const activeHistoryFilterCount = computed(() => [
  historyKeyword.value.trim().length > 0,
  historyAudienceFilter.value !== 'all',
  historyLevelFilter.value !== 'all'
].filter(Boolean).length)

async function applyHistoryFilters() {
  await history.applyFilters()
}

async function resetHistoryFilters() {
  historyKeyword.value = ''
  historyAudienceFilter.value = 'all'
  historyLevelFilter.value = 'all'
  await applyHistoryFilters()
}

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailMessage = ref<AdminNotificationMessageRow | null>(null)
const detailRows = ref<AdminNotificationDeliveryRow[]>([])
const detailPage = ref(1)
const detailPageSize = 50
const detailTotal = ref(0)

async function loadDetailPage(page: number) {
  const messageId = detailMessage.value?.id
  if (!messageId) return

  detailPage.value = page
  detailLoading.value = true
  detailRows.value = []
  try {
    const res = await $fetch('/api/admin/notifications/detail', {
      query: { messageId, limit: detailPageSize, offset: (page - 1) * detailPageSize }
    })
    detailRows.value = res?.deliveries || []
    detailTotal.value = res?.total || 0
  } catch (err: unknown) {
    toast.add({
      title: parseFetchError(err, t('admin.content.notifications.detail.loadFailed')),
      color: 'error'
    })
  } finally {
    detailLoading.value = false
  }
}

async function openDetail(row: AdminNotificationMessageRow) {
  detailMessage.value = row
  detailOpen.value = true
  detailTotal.value = 0
  await loadDetailPage(1)
}

const confirm = useConfirmDialog()

async function openDelete(row: AdminNotificationMessageRow) {
  await confirm({
    title: t('admin.content.notifications.delete.title', { title: row.title || '' }),
    description: t('admin.content.notifications.delete.description'),
    onConfirm: async () => {
      try {
        await $fetch('/api/admin/notifications/delete', {
          method: 'POST',
          body: { messageId: row.id }
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

const detailDescription = computed(() => {
  if (!detailMessage.value) return undefined
  return t('admin.content.notifications.detail.description', {
    title: detailMessage.value.title,
    time: formatDateTime(detailMessage.value.createdAt, '-', locale.value),
    audience: getAudienceMeta(detailMessage.value.audience).label,
    delivered: detailMessage.value.deliveredCount.toLocaleString(locale.value),
    read: detailMessage.value.readCount.toLocaleString(locale.value)
  })
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center gap-2">
      <AdminFilterPopover
        :active-count="activeHistoryFilterCount"
        @apply="applyHistoryFilters"
        @reset="resetHistoryFilters"
      >
        <UFormField :label="$t('common.filters.keyword')">
          <UInput
            v-model="historyKeyword"
            :placeholder="$t('admin.content.notifications.searchPlaceholder')"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('admin.content.notifications.filters.audience')">
          <USelect
            v-model="historyAudienceFilter"
            :items="historyAudienceFilterOptions"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('admin.content.notifications.filters.level')">
          <USelect
            v-model="historyLevelFilter"
            :items="historyLevelFilterOptions"
            class="w-full"
          />
        </UFormField>
      </AdminFilterPopover>
      <div class="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
        <UButton
          icon="i-mdi-send"
          @click="openSendModal"
        >
          {{ $t('admin.content.notifications.actions.send') }}
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
      :title="$t('admin.content.notifications.historyTitle')"
      icon="i-mdi-history"
    >
      <DashboardDataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :data="messagesData"
        :columns="columns"
        :loading="loading"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :empty-title="$t('admin.content.notifications.emptyHistory')"
        empty-icon="i-mdi-history"
      >
        <template #title-cell="{ row }">
          <div class="flex items-center gap-2">
            <UBadge
              :color="levelMeta[row.original.level].color"
              variant="subtle"
              size="sm"
            >
              {{ $t(`common.notifications.levels.${row.original.level}`) }}
            </UBadge>
            <UBadge
              :color="getAudienceMeta(row.original.audience).color"
              variant="soft"
              size="sm"
            >
              {{ getAudienceMeta(row.original.audience).label }}
            </UBadge>
            <span class="font-medium truncate max-w-[260px]">{{ row.original.title }}</span>
          </div>
        </template>
        <template #delivery-cell="{ row }">
          <div class="flex flex-col text-xs">
            <span class="tabular-nums">
              {{ $t('admin.content.notifications.delivery.delivered', {
                count: row.original.deliveredCount.toLocaleString(locale)
              }) }}
            </span>
            <span class="text-muted tabular-nums">
              {{ $t('admin.content.notifications.delivery.read', {
                count: row.original.readCount.toLocaleString(locale)
              }) }}
            </span>
          </div>
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
                :aria-label="$t('admin.content.notifications.actions.more', { title: row.original.title })"
                color="neutral"
                variant="ghost"
                size="sm"
              />
            </UDropdownMenu>
          </div>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>

    <LazyAdminNotificationSendModal
      v-if="sendModalOpen"
      v-model:open="sendModalOpen"
      @sent="applyHistoryFilters"
    />

    <UModal
      v-model:open="detailOpen"
      :title="$t('admin.content.notifications.detail.title')"
      :description="detailDescription"
      :ui="adminModalUi({ content: 'sm:max-w-2xl' })"
    >
      <template #body>
        <div
          v-if="detailLoading"
          class="text-center text-sm text-muted py-8"
        >
          {{ $t('common.states.loading') }}
        </div>
        <div
          v-else-if="detailRows.length === 0"
          class="text-center text-sm text-muted py-8"
        >
          {{ $t('admin.content.notifications.detail.empty') }}
        </div>
        <div
          v-else
          class="space-y-4"
        >
          <div class="divide-y divide-default">
            <div
              v-for="r in detailRows"
              :key="r.id"
              class="flex items-center gap-3 py-2 text-sm"
            >
              <UIcon
                :name="r.isRead ? 'i-mdi-email-open-outline' : 'i-mdi-email-outline'"
                :class="r.isRead ? 'text-success' : 'text-muted'"
                class="size-4"
              />
              <span class="flex-1 font-medium">
                {{ r.recipientUsername || `#${r.recipientUserId}` }}
              </span>
              <span class="text-xs text-muted">
                {{ r.isRead
                  ? $t('admin.content.notifications.detail.readAt', {
                    time: formatDateTime(r.readAt, '-', locale)
                  })
                  : $t('admin.content.notifications.detail.unread') }}
              </span>
            </div>
          </div>
          <UPagination
            v-if="detailTotal > detailPageSize"
            :page="detailPage"
            :items-per-page="detailPageSize"
            :total="detailTotal"
            :sibling-count="compactPagination ? 0 : 1"
            :show-edges="!compactPagination"
            :ui="{ first: 'hidden', last: 'hidden', list: 'flex-wrap gap-1' }"
            size="sm"
            class="justify-center"
            @update:page="loadDetailPage"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
