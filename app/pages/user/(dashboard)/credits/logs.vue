<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { useCreditReasonMeta } from '~/composables/use-credit-reason-meta'
import { useUserCreditsPage, type TransactionRow } from '~/composables/user/use-user-credits-page'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'

const { t, locale } = useI18n()
const { getReasonColor, getReasonLabel } = useCreditReasonMeta()

const {
  filters,
  page,
  pageSize,
  items,
  total,
  loading,
  fetchTransactions,
  applyFilters,
  resetFilters
} = useUserCreditsPage()

onMounted(() => {
  void fetchTransactions()
})

const reasonItems = computed(() => [
  { label: t('user.credits.logs.filters.allTypes'), value: 'all' },
  { label: getReasonLabel('api_charge'), value: 'api_charge' },
  { label: getReasonLabel('api_refund'), value: 'api_refund' },
  { label: getReasonLabel('redemption_code'), value: 'redemption_code' },
  { label: getReasonLabel('checkin'), value: 'checkin' },
  { label: getReasonLabel('admin_grant'), value: 'admin_grant' },
  { label: getReasonLabel('admin_revoke'), value: 'admin_revoke' },
  { label: getReasonLabel('admin_reset'), value: 'admin_reset' },
  { label: getReasonLabel('signup_bonus'), value: 'signup_bonus' }
])

const directionItems = computed(() => [
  { label: t('user.credits.logs.filters.allDirections'), value: 'all' },
  { label: t('user.credits.logs.filters.income'), value: 'in' },
  { label: t('user.credits.logs.filters.expense'), value: 'out' }
])

const activeFilterCount = computed(() => [
  filters.reason !== 'all',
  filters.direction !== 'all'
].filter(Boolean).length)

const columns = computed<TableColumn<TransactionRow>[]>(() => [
  { accessorKey: 'createdAt', header: t('user.credits.logs.columns.time') },
  { accessorKey: 'reason', header: t('user.credits.logs.columns.type') },
  { accessorKey: 'amount', header: t('user.credits.logs.columns.change') },
  { accessorKey: 'balanceAfter', header: t('user.credits.logs.columns.balanceAfter') },
  { id: 'detail', header: t('user.credits.logs.columns.related') },
  { accessorKey: 'remark', header: t('user.credits.logs.columns.remark') }
])

function amountClass(amt: number) {
  if (amt > 0) return 'text-success font-semibold tabular-nums'
  if (amt < 0) return 'text-error font-semibold tabular-nums'
  return 'text-muted tabular-nums'
}

async function resetCreditFilters() {
  await resetFilters()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-1.5">
      <AdminFilterPopover
        :active-count="activeFilterCount"
        @apply="applyFilters"
        @reset="resetCreditFilters"
      >
        <UFormField :label="$t('user.credits.logs.filters.type')">
          <USelect
            v-model="filters.reason"
            :items="reasonItems"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('user.credits.logs.filters.direction')">
          <USelect
            v-model="filters.direction"
            :items="directionItems"
            class="w-full"
          />
        </UFormField>
      </AdminFilterPopover>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="loading"
        @click="fetchTransactions"
      >
        {{ $t('common.actions.refresh') }}
      </UButton>
    </div>

    <DashboardTableCard
      :title="$t('user.credits.logs.title')"
      icon="i-mdi-format-list-bulleted"
    >
      <DashboardDataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :data="items"
        :columns="columns"
        :loading="loading"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :fixed="false"
        :empty-title="$t('user.credits.logs.empty')"
        empty-icon="i-mdi-format-list-bulleted"
      >
        <template #createdAt-cell="{ row }">
          <span class="text-xs text-muted whitespace-nowrap tabular-nums">{{ formatDateTime(row.original.createdAt, '-', locale) }}</span>
        </template>
        <template #reason-cell="{ row }">
          <UBadge
            :color="getReasonColor(row.original.reason)"
            variant="subtle"
            size="sm"
          >
            {{ getReasonLabel(row.original.reason) }}
          </UBadge>
        </template>
        <template #amount-cell="{ row }">
          <span :class="amountClass(Number(row.original.amount) || 0)">
            {{ (Number(row.original.amount) || 0) > 0 ? '+' : '' }}{{ (Number(row.original.amount) || 0).toLocaleString(locale) }}
          </span>
        </template>
        <template #balanceAfter-cell="{ row }">
          <span class="tabular-nums">{{ Number(row.original.balanceAfter).toLocaleString(locale) }}</span>
        </template>
        <template #detail-cell="{ row }">
          <div
            v-if="row.original.routeId && row.original.apiName"
            class="flex flex-col text-xs"
          >
            <span class="font-medium">{{ row.original.apiName }}</span>
            <span class="font-mono text-muted">{{ row.original.apiPath || '' }}</span>
            <span
              v-if="row.original.apiCallId"
              class="text-muted text-xs"
            >{{ $t('user.credits.logs.callNumber', { id: row.original.apiCallId }) }}</span>
          </div>
          <div
            v-else-if="row.original.reason === 'redemption_code' && (row.original.code || row.original.codeId)"
            class="flex flex-col text-xs"
          >
            <span class="text-muted">{{ $t('user.credits.redeem.code') }}</span>
            <span class="font-mono">{{ row.original.code || `#${row.original.codeId}` }}</span>
          </div>
          <div
            v-else-if="row.original.operatorName"
            class="flex flex-col text-xs"
          >
            <span class="text-muted">{{ $t('user.credits.logs.operator') }}</span>
            <span>{{ row.original.operatorName }}</span>
          </div>
          <span
            v-else
            class="text-muted text-xs"
          >-</span>
        </template>
        <template #remark-cell="{ row }">
          <span class="text-xs text-muted truncate max-w-[280px] block">{{ row.original.remark || '-' }}</span>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>
  </div>
</template>
