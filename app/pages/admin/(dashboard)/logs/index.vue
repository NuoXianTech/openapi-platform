<script setup lang="ts">
import ApiHttpMethodBadge from '~/components/api/HttpMethodBadge.vue'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { LazyAdminCallLogDetailModal } from '#components'
import {
  ADMIN_CALL_LOG_TYPE_META,
  useAdminCallLogsPage
} from '~/composables/admin/use-admin-call-logs-page'
import type { AdminLogRow } from '#shared/types/admin'

const { t, locale } = useI18n()
useHead({ title: () => t('admin.logs.call.title') })
const route = useRoute()
const router = useRouter()
const {
  filters,
  page,
  pageSize,
  items,
  total,
  loading,
  refresh,
  applyFilters,
  typeSelectItems,
  apiSelectItems,
  categorySelectItems,
  advancedFilterCount,
  columns,
  loadFilterOptions,
  cleanupHasFilters,
  cleanupLoading,
  cleanupMatchCount,
  cleanupOpen,
  confirmCleanup,
  openCleanup
} = useAdminCallLogsPage({
  routeQuery: computed(() => route.query),
  replaceQuery: async (query) => {
    await router.replace({ query })
  }
})

const overlay = useOverlay()

onMounted(() => {
  void loadFilterOptions()
})

function openDetail(row: AdminLogRow) {
  const detailModal = overlay.create(LazyAdminCallLogDetailModal, {
    destroyOnClose: true,
    props: { row }
  })
  void detailModal.open()
}

async function resetAdvancedFilters() {
  filters.routeId = ''
  filters.categoryId = 0
  filters.types = []
  filters.apiKeyId = ''
  filters.userId = ''
  filters.requestId = ''
  await applyFilters()
}
</script>

<template>
  <div class="space-y-6">
    <DashboardPageIntro
      :title="$t('admin.logs.call.title')"
      :description="$t('admin.logs.call.description')"
    />

    <div class="flex flex-wrap items-center gap-2">
      <UInput
        v-model="filters.keyword"
        type="search"
        icon="i-mdi-magnify"
        :placeholder="$t('admin.logs.call.searchPlaceholder')"
        :aria-label="$t('admin.logs.call.searchPlaceholder')"
        class="w-full sm:w-80"
        @keyup.enter="applyFilters"
      />
      <AdminFilterPopover
        :active-count="advancedFilterCount"
        :title="$t('admin.logs.call.filterTitle')"
        panel-class="w-[min(calc(100vw-2rem),38rem)] p-3"
        @apply="applyFilters"
        @reset="resetAdvancedFilters"
      >
        <div class="grid gap-3 md:grid-cols-2">
          <UFormField :label="$t('admin.logs.call.filters.apiName')">
            <USelectMenu
              v-model="filters.routeId"
              :items="apiSelectItems"
              value-key="value"
              searchable
              :placeholder="$t('admin.logs.call.filters.allApis')"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('admin.logs.call.filters.category')">
            <USelect
              v-model="filters.categoryId"
              :items="categorySelectItems"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('admin.logs.call.filters.type')">
            <USelectMenu
              v-model="filters.types"
              :items="typeSelectItems"
              value-key="value"
              multiple
              :placeholder="$t('admin.logs.call.filters.allTypes')"
              class="w-full"
            />
          </UFormField>
          <div class="border-t border-default pt-3 md:col-span-2">
            <p class="mb-3 text-xs font-medium text-muted">
              {{ $t('admin.logs.call.filters.exact') }}
            </p>
            <div class="grid gap-3 md:grid-cols-3">
              <UFormField
                :label="$t('admin.logs.call.filters.keyName')"
                :hint="$t('admin.logs.call.filters.keyHint')"
              >
                <UInput
                  v-model.number="filters.apiKeyId"
                  type="number"
                  :placeholder="$t('admin.logs.call.filters.emptyAll')"
                  class="w-full"
                />
              </UFormField>
              <UFormField
                :label="$t('admin.logs.call.filters.user')"
                :hint="$t('admin.logs.call.filters.userHint')"
              >
                <UInput
                  v-model.number="filters.userId"
                  type="number"
                  :placeholder="$t('admin.logs.call.filters.emptyAll')"
                  class="w-full"
                />
              </UFormField>
              <UFormField :label="$t('admin.logs.call.filters.requestId')">
                <UInput
                  v-model="filters.requestId"
                  :placeholder="$t('admin.logs.call.filters.requestIdPlaceholder')"
                  class="w-full"
                />
              </UFormField>
            </div>
          </div>
        </div>
      </AdminFilterPopover>
      <div class="ml-auto flex w-full flex-wrap items-center justify-end gap-2 lg:w-auto">
        <CommonDateRangePicker
          v-model:start="filters.startAt"
          v-model:end="filters.endAt"
          :placeholder="$t('admin.logs.call.filters.allTime')"
          class="w-full sm:w-64"
          @apply="applyFilters"
        />
        <UButton
          color="error"
          variant="soft"
          icon="i-lucide-trash-2"
          :loading="loading && !cleanupOpen"
          :disabled="cleanupLoading"
          @click="openCleanup"
        >
          {{ $t('admin.logs.cleanup.button') }}
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="loading"
          @click="refresh"
        >
          {{ $t('common.actions.refresh') }}
        </UButton>
      </div>
    </div>

    <DashboardTableCard
      :title="$t('admin.logs.call.detailsTitle')"
      icon="i-mdi-text-box-search-outline"
    >
      <DashboardDataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :data="items"
        :columns="columns"
        :loading="loading"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :empty-title="$t('admin.logs.call.empty')"
        empty-icon="i-mdi-text-box-search-outline"
      >
        <template #createdAt-cell="{ row }">
          <div class="flex flex-col gap-1 min-w-[150px]">
            <span class="text-xs whitespace-nowrap">
              {{ formatDateTime(row.original.createdAt, '-', locale) }}
            </span>
            <UBadge
              :color="ADMIN_CALL_LOG_TYPE_META[row.original.type].color"
              :icon="ADMIN_CALL_LOG_TYPE_META[row.original.type].icon"
              variant="subtle"
              size="sm"
              class="w-fit"
            >
              {{ $t(ADMIN_CALL_LOG_TYPE_META[row.original.type].messageKey) }}
            </UBadge>
          </div>
        </template>

        <template #userName-cell="{ row }">
          <div
            v-if="row.original.userId"
            class="flex flex-col text-xs"
          >
            <span>{{ row.original.userName || '-' }}</span>
            <span class="text-muted">
              {{ row.original.userRole === 'admin'
                ? $t('common.identities.adminWithId', { id: row.original.userId })
                : $t('common.identities.userWithId', { id: row.original.userId }) }}
            </span>
          </div>
          <span
            v-else
            class="text-xs text-muted"
          >{{ $t('common.identities.anonymous') }}</span>
        </template>

        <template #apiKeyName-cell="{ row }">
          <span
            v-if="row.original.apiKeyName || row.original.apiKeyId"
            class="text-xs"
          >{{ row.original.apiKeyName || `#${row.original.apiKeyId}` }}</span>
          <span
            v-else
            class="text-xs text-muted"
          >-</span>
        </template>

        <template #apiName-cell="{ row }">
          <div
            v-if="row.original.apiName"
            class="flex flex-col"
          >
            <span class="text-sm font-medium">{{ row.original.apiName }}</span>
            <span class="font-mono text-xs text-muted">{{ row.original.apiPath }}</span>
          </div>
          <span
            v-else
            class="text-xs text-muted"
          >-</span>
        </template>

        <template #cost-cell="{ row }">
          <span
            class="tabular-nums text-sm"
            :class="row.original.cost > 0 ? 'text-warning font-medium' : 'text-muted'"
          >
            {{ row.original.cost > 0 ? `-${row.original.cost}` : $t('admin.logs.call.free') }}
          </span>
        </template>

        <template #summary-cell="{ row }">
          <div class="flex flex-col text-xs gap-0.5">
            <div class="flex items-center gap-1.5">
              <ApiHttpMethodBadge :method="row.original.method" />
              <span
                class="tabular-nums"
                :class="row.original.statusCode >= 400 ? 'text-error' : 'text-default'"
              >
                {{ row.original.statusCode }}
              </span>
              <span class="text-muted tabular-nums">
                · {{ $t('admin.logs.call.milliseconds', { value: row.original.latencyMs }) }}
              </span>
              <UTooltip
                v-if="!row.original.isCounted"
                :text="$t('admin.logs.call.outcomes.notCounted')"
                :content="{ side: 'top' }"
              >
                <UBadge
                  color="warning"
                  variant="subtle"
                  size="sm"
                >
                  {{ $t('admin.logs.call.outcomes.rejected') }}
                </UBadge>
              </UTooltip>
            </div>
            <UTooltip
              v-if="row.original.errorMessage"
              :text="row.original.errorMessage"
              :content="{ side: 'top' }"
            >
              <span class="text-muted truncate max-w-[280px]">
                {{ row.original.errorCode ? `${row.original.errorCode}: ` : '' }}{{ row.original.errorMessage }}
              </span>
            </UTooltip>
          </div>
        </template>

        <template #actions-cell="{ row }">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-mdi-eye-outline"
            :aria-label="$t('common.actions.viewDetails')"
            @click="openDetail(row.original)"
          />
        </template>
      </DashboardDataTable>
    </DashboardTableCard>

    <AdminLogCleanupModal
      v-model:open="cleanupOpen"
      :log-type-label="$t('admin.logs.call.title')"
      :match-count="cleanupMatchCount"
      :has-filters="cleanupHasFilters"
      :loading="cleanupLoading"
      :note="$t('admin.logs.call.cleanupNote')"
      :on-confirm="confirmCleanup"
    />
  </div>
</template>
