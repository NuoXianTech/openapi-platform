<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AdminCreditTransactionRow } from '#shared/types/admin-credits'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { useCreditReasonMeta } from '~/composables/use-credit-reason-meta'
import { useAdminCreditTransactionsPage } from '~/composables/admin/use-admin-credit-transactions-page'
import { parseFetchError } from '~/utils/client-error'

const { t, locale } = useI18n()
const { getReasonColor, getReasonLabel } = useCreditReasonMeta()
const {
  filters, page, pageSize, items, total, loading, error, refresh, applyFilters,
  statusItems, advancedFilterCount, statusLabel, statusColor, resetAdvancedFilters,
  processingOpen, selectedReservation, selectedAction, processing, processingError,
  feedback, processingActions, openProcessing, processReservation
} = useAdminCreditTransactionsPage()

useHead({ title: () => t('admin.credits.transactions.title') })

const reasonItems = computed(() => [
  { label: t('admin.credits.transactions.filters.allReasons'), value: 'all' },
  { label: getReasonLabel('admin_grant'), value: 'admin_grant' },
  { label: getReasonLabel('admin_revoke'), value: 'admin_revoke' },
  { label: getReasonLabel('admin_reset'), value: 'admin_reset' },
  { label: getReasonLabel('api_charge'), value: 'api_charge' },
  { label: getReasonLabel('api_refund'), value: 'api_refund' },
  { label: getReasonLabel('signup_bonus'), value: 'signup_bonus' },
  { label: getReasonLabel('redemption_code'), value: 'redemption_code' },
  { label: getReasonLabel('checkin'), value: 'checkin' }
])

const directionItems = computed(() => [
  { label: t('admin.credits.transactions.filters.allDirections'), value: 'all' },
  { label: t('admin.credits.transactions.filters.income'), value: 'in' },
  { label: t('admin.credits.transactions.filters.expense'), value: 'out' }
])

const columns = computed<TableColumn<AdminCreditTransactionRow>[]>(() => [
  { accessorKey: 'createdAt', header: t('admin.credits.transactions.columns.time') },
  { accessorKey: 'userId', header: t('admin.credits.transactions.columns.user') },
  { accessorKey: 'reason', header: t('admin.credits.transactions.columns.reason') },
  { accessorKey: 'amount', header: t('admin.credits.transactions.columns.amount') },
  { accessorKey: 'balanceAfter', header: t('admin.credits.transactions.columns.balance') },
  { accessorKey: 'status', header: t('admin.credits.transactions.columns.status') },
  { accessorKey: 'operatorName', header: t('admin.credits.transactions.columns.operator') },
  { accessorKey: 'remark', header: t('admin.credits.transactions.columns.remark') },
  { id: 'actions', header: t('admin.credits.transactions.columns.actions') }
])

function amountClass(row: AdminCreditTransactionRow) {
  if (row.kind === 'reservation') return 'text-warning'
  return row.amount > 0 ? 'text-success' : row.amount < 0 ? 'text-error' : 'text-muted'
}
</script>

<template>
  <div class="space-y-5">
    <DashboardPageIntro
      :title="$t('admin.credits.transactions.title')"
      :description="$t('admin.credits.transactions.description')"
    />

    <div class="flex flex-wrap items-center gap-2">
      <USelect
        v-model="filters.status"
        :items="statusItems"
        :aria-label="$t('admin.credits.transactions.filters.status')"
        class="w-full sm:w-48"
        @update:model-value="applyFilters"
      />
      <AdminFilterPopover
        :active-count="advancedFilterCount"
        :title="$t('admin.credits.transactions.filterTitle')"
        panel-class="w-[calc(100vw-2rem)] max-w-xl p-3"
        @apply="applyFilters"
        @reset="resetAdvancedFilters"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="$t('admin.credits.transactions.filters.userId')">
            <UInput
              v-model.number="filters.userId"
              type="number"
              min="1"
              :placeholder="$t('admin.credits.transactions.filters.emptyAll')"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('admin.credits.transactions.filters.reason')">
            <USelect v-model="filters.reason" :items="reasonItems" class="w-full" />
          </UFormField>
          <UFormField :label="$t('admin.credits.transactions.filters.direction')">
            <USelect v-model="filters.direction" :items="directionItems" class="w-full" />
          </UFormField>
          <UFormField :label="$t('admin.credits.transactions.filters.operator')">
            <UInput
              v-model="filters.operatorName"
              :placeholder="$t('admin.credits.transactions.filters.operatorPlaceholder')"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('admin.credits.transactions.filters.minAmount')">
            <UInput
              v-model.number="filters.minAmount"
              type="number"
              :placeholder="$t('admin.credits.transactions.filters.minAmountPlaceholder')"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('admin.credits.transactions.filters.maxAmount')">
            <UInput
              v-model.number="filters.maxAmount"
              type="number"
              :placeholder="$t('admin.credits.transactions.filters.maxAmountPlaceholder')"
              class="w-full"
            />
          </UFormField>
        </div>
      </AdminFilterPopover>
      <div class="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
        <CommonDateRangePicker
          v-model:start="filters.startAt"
          v-model:end="filters.endAt"
          class="w-full sm:w-64"
          @apply="applyFilters"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="loading"
          :disabled="processing"
          @click="refresh"
        >
          {{ $t('common.actions.refresh') }}
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="feedback"
      :color="feedback.color"
      variant="subtle"
      :icon="feedback.color === 'success' ? 'i-lucide-circle-check' : 'i-lucide-circle-alert'"
      :title="feedback.message"
    />
    <UAlert
      v-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="parseFetchError(error, $t('common.feedback.loadFailed'))"
    />

    <DashboardTableCard
      :title="$t('admin.credits.transactions.detailsTitle')"
      :total="total"
      icon="i-mdi-cash-multiple"
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
        :get-row-id="row => row.key"
        :empty-title="$t(filters.status === 'exceptions' || filters.status === 'dead_letter'
          ? 'admin.credits.transactions.emptyExceptions'
          : 'admin.credits.transactions.empty')"
        empty-icon="i-mdi-cash-multiple"
      >
        <template #createdAt-cell="{ row }">
          <span class="whitespace-nowrap text-xs text-muted">{{ formatDateTime(row.original.createdAt, '—', locale) }}</span>
        </template>
        <template #userId-cell="{ row }">
          <div class="flex min-w-24 max-w-40 flex-col text-xs">
            <span class="truncate">{{ row.original.userName || $t('common.accounts.deletedUser') }}</span>
            <span v-if="row.original.userId !== null" class="text-muted">
              {{ row.original.userRole === 'admin'
                ? $t('common.identities.adminWithId', { id: row.original.userId })
                : $t('common.identities.userWithId', { id: row.original.userId }) }}
            </span>
          </div>
        </template>
        <template #reason-cell="{ row }">
          <div class="max-w-52 space-y-1">
            <UBadge :color="getReasonColor(row.original.reason)" variant="subtle">
              {{ getReasonLabel(row.original.reason) }}
            </UBadge>
            <p v-if="row.original.routeName" class="truncate text-xs text-muted" :title="row.original.routeName">
              {{ row.original.routeName }}
            </p>
            <code v-if="row.original.routePath" class="block truncate text-xs text-muted" :title="row.original.routePath">
              {{ row.original.routePath }}
            </code>
          </div>
        </template>
        <template #amount-cell="{ row }">
          <div class="whitespace-nowrap">
            <span class="font-semibold tabular-nums" :class="amountClass(row.original)">
              {{ row.original.amount > 0 ? '+' : '' }}{{ row.original.amount.toLocaleString(locale) }}
            </span>
            <p v-if="row.original.kind === 'reservation'" class="text-xs text-muted">
              {{ $t('admin.credits.transactions.reservedAmount') }}
            </p>
          </div>
        </template>
        <template #balanceAfter-cell="{ row }">
          <span class="tabular-nums text-xs text-muted">
            {{ row.original.balanceAfter === null ? '—' : row.original.balanceAfter.toLocaleString(locale) }}
          </span>
        </template>
        <template #status-cell="{ row }">
          <UBadge :color="statusColor(row.original)" variant="subtle">
            {{ statusLabel(row.original) }}
          </UBadge>
        </template>
        <template #operatorName-cell="{ row }">
          <div v-if="row.original.operatorName || row.original.operatorId" class="flex max-w-32 flex-col text-xs">
            <span class="truncate">{{ row.original.operatorName || '—' }}</span>
            <span v-if="row.original.operatorId" class="text-muted">
              {{ $t('common.identities.adminWithId', { id: row.original.operatorId }) }}
            </span>
          </div>
          <span v-else class="text-xs text-muted">
            {{ row.original.kind === 'reservation' ? '—' : $t('common.identities.system') }}
          </span>
        </template>
        <template #remark-cell="{ row }">
          <span
            class="block max-w-64 truncate text-xs text-muted"
            :title="row.original.reservation?.lastError || row.original.remark || undefined"
          >{{ row.original.reservation?.lastError || row.original.remark || '—' }}</span>
        </template>
        <template #actions-cell="{ row }">
          <UButton
            v-if="row.original.kind === 'reservation'"
            icon="i-lucide-wrench"
            :color="row.original.status === 'dead_letter' ? 'warning' : 'neutral'"
            variant="outline"
            size="sm"
            class="whitespace-nowrap"
            :disabled="loading || processing"
            @click="openProcessing(row.original)"
          >
            {{ $t('admin.credits.transactions.processing.title') }}
          </UButton>
          <span v-else class="text-xs text-dimmed">—</span>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>

    <LazyAdminCreditTransactionProcessingModal
      v-if="selectedReservation"
      v-model:open="processingOpen"
      v-model:action="selectedAction"
      :row="selectedReservation"
      :actions="processingActions"
      :processing="processing"
      :error="processingError"
      :status-label="statusLabel(selectedReservation)"
      @submit="processReservation"
    />
  </div>
</template>
