<script setup lang="ts">
import ApiHttpMethodBadge from '~/components/api/HttpMethodBadge.vue'
import { LazyUserCallLogDetailModal } from '#components'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { useDashboardColumnVisibility } from '~/composables/dashboard/use-dashboard-column-visibility'
import {
  useUserCallLogsPage,
  useUserCallOutcomeMeta,
  userCallOutcomeColor,
  userCallOutcomeIcon,
  type UserCallLogRow
} from '~/composables/user/use-user-call-logs-page'

const { t, locale } = useI18n()
const { getOutcomeLabel } = useUserCallOutcomeMeta()

useHead({ title: () => t('user.logs.title') })

const {
  filters,
  page,
  pageSize,
  items,
  total,
  loading,
  applyFilters,
  resetFilters,
  apiSelectItems,
  keySelectItems,
  statusSelectItems,
  activeFilterCount,
  columns,
  loadFilterOptions
} = useUserCallLogsPage()

const overlay = useOverlay()
const { columnVisibility, columnVisibilityItems } = useDashboardColumnVisibility(columns)

onMounted(() => {
  void loadFilterOptions()
})

function openDetail(row: UserCallLogRow) {
  const detailModal = overlay.create(LazyUserCallLogDetailModal, {
    destroyOnClose: true,
    props: { row }
  })
  void detailModal.open()
}
</script>

<template>
  <UDashboardPanel id="user-logs">
    <template #header>
      <DashboardPageNavbar :title="$t('user.logs.title')" />
    </template>

    <template #body>
      <div class="dashboard-section-page space-y-6">
        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model="filters.keyword"
            icon="i-mdi-magnify"
            :placeholder="$t('user.logs.searchPlaceholder')"
            class="w-full sm:w-72"
            @keyup.enter="applyFilters"
          />
          <AdminFilterPopover
            :active-count="activeFilterCount"
            @apply="applyFilters"
            @reset="resetFilters"
          >
            <UFormField :label="$t('user.logs.filters.api')">
              <USelectMenu
                v-model="filters.routeId"
                :items="apiSelectItems"
                value-key="value"
                searchable
                :placeholder="$t('user.logs.filters.allApis')"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('user.apiKeys.title')">
              <USelect
                v-model="filters.apiKeyId"
                :items="keySelectItems"
                value-key="value"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('user.logs.filters.status')">
              <USelect
                v-model="filters.status"
                :items="statusSelectItems"
                value-key="value"
                class="w-full"
              />
            </UFormField>
          </AdminFilterPopover>

          <div class="ml-auto flex flex-wrap items-center gap-2">
            <UDropdownMenu
              :items="columnVisibilityItems"
              :content="{ align: 'end' }"
            >
              <UButton
                :label="$t('user.logs.showColumns')"
                color="neutral"
                variant="outline"
                icon="i-mdi-view-column-outline"
              />
            </UDropdownMenu>
          </div>
        </div>

        <DashboardTableCard
          :title="$t('user.logs.detailsTitle')"
          icon="i-mdi-text-box-search-outline"
        >
          <DashboardDataTable
            v-model:page="page"
            v-model:page-size="pageSize"
            v-model:column-visibility="columnVisibility"
            :data="items"
            :columns="columns"
            :loading="loading"
            :total="total"
            :page-size-options="PAGE_SIZE_OPTIONS"
            :empty-title="$t('user.logs.empty')"
            empty-icon="i-mdi-text-box-search-outline"
          >
            <template #createdAt-cell="{ row }">
              <div class="flex flex-col gap-1 min-w-[150px]">
                <span class="text-xs whitespace-nowrap">
                  {{ formatDateTime(row.original.createdAt, '-', locale) }}
                </span>
                <UBadge
                  :color="userCallOutcomeColor(row.original)"
                  :icon="userCallOutcomeIcon(row.original)"
                  variant="subtle"
                  size="sm"
                  class="w-fit"
                >
                  {{ getOutcomeLabel(row.original) }}
                </UBadge>
              </div>
            </template>

            <template #apiKeyName-cell="{ row }">
              <span
                v-if="row.original.apiKeyName || row.original.apiKeyId"
                class="text-xs"
              >{{ row.original.apiKeyName || `#${row.original.apiKeyId}` }}</span>
              <span
                v-else
                class="text-xs text-muted"
              >{{ $t('user.logs.noApiKey') }}</span>
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
                class="font-mono text-xs text-muted"
              >{{ row.original.apiPath }}</span>
            </template>

            <template #creditsCost-cell="{ row }">
              <span
                class="tabular-nums text-sm"
                :class="row.original.creditsCost > 0 ? 'text-warning font-medium' : 'text-muted'"
              >
                {{ row.original.creditsCost > 0 ? `-${row.original.creditsCost.toLocaleString(locale)}` : $t('user.logs.free') }}
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
                    · {{ $t('user.logs.milliseconds', { value: row.original.latencyMs.toLocaleString(locale) }) }}
                  </span>
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
                :aria-label="$t('user.logs.viewDetails')"
                @click="openDetail(row.original)"
              />
            </template>
          </DashboardDataTable>
        </DashboardTableCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
