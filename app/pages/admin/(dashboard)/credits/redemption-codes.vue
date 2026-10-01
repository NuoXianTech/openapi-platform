<script setup lang="ts">
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import {
  useAdminRedemptionCodesDisplayMeta,
  useRedemptionCodesPage
} from '~/composables/admin/use-redemption-codes-page'

const { t, locale } = useI18n()
useHead({ title: () => t('admin.credits.redemptionCodes.title') })
const {
  filters,
  page,
  pageSize,
  items,
  total,
  loading,
  revealedCodes,
  revealingCodeIds,
  batches,
  init,
  applyFilters,
  generate,
  toggle,
  remove,
  toggleBatch,
  deleteBatch,
  copyOne,
  copyAll,
  toggleCodeVisibility
} = useRedemptionCodesPage()

const generateOpen = ref(false)
const activeFilterCount = computed(() => [
  filters.keyword.trim().length > 0,
  filters.status !== 'all',
  filters.batchId !== 'all'
].filter(Boolean).length)

onMounted(() => {
  void init()
})

function openGenerateModal() {
  generateOpen.value = true
}

async function resetRedemptionFilters() {
  filters.keyword = ''
  filters.status = 'all'
  filters.batchId = 'all'
  await applyFilters()
}

const {
  statusItems,
  batchItems,
  columns,
  statusOf,
  getRowItems,
  onBatchFilter
} = useAdminRedemptionCodesDisplayMeta({
  batches,
  filters,
  applyFilters,
  toggle,
  remove
})
</script>

<template>
  <div class="space-y-6">
    <DashboardPageIntro
      :title="$t('admin.credits.redemptionCodes.title')"
      :description="$t('admin.credits.redemptionCodes.description')"
    />

    <div class="flex flex-wrap items-center justify-between gap-1.5">
      <AdminFilterPopover
        :active-count="activeFilterCount"
        @apply="applyFilters"
        @reset="resetRedemptionFilters"
      >
        <UFormField :label="$t('common.filters.keyword')">
          <UInput
            v-model="filters.keyword"
            :placeholder="$t('admin.credits.redemptionCodes.searchPlaceholder')"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('admin.credits.redemptionCodes.filters.status')">
          <USelect
            v-model="filters.status"
            :items="statusItems"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            class="w-full"
          />
        </UFormField>
        <UFormField :label="$t('admin.credits.redemptionCodes.filters.batch')">
          <USelect
            v-model="filters.batchId"
            :items="batchItems"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            class="w-full"
          />
        </UFormField>
      </AdminFilterPopover>

      <div class="flex flex-wrap items-center gap-1.5">
        <UButton
          icon="i-mdi-plus"
          color="primary"
          @click="openGenerateModal"
        >
          {{ $t('admin.credits.redemptionCodes.actions.generate') }}
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          :loading="loading"
          @click="init"
        >
          {{ $t('common.actions.refresh') }}
        </UButton>
      </div>
    </div>

    <AdminRedemptionCodeBatchCard
      :batches="batches"
      @filter="onBatchFilter"
      @toggle="toggleBatch"
      @delete="deleteBatch"
    />

    <DashboardTableCard
      :title="$t('admin.credits.redemptionCodes.detailsTitle')"
      icon="i-mdi-ticket-percent-outline"
    >
      <DashboardDataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :data="items"
        :columns="columns"
        :loading="loading"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :empty-title="$t('admin.credits.redemptionCodes.empty')"
        empty-icon="i-mdi-ticket-percent-outline"
      >
        <template #codePreview-cell="{ row }">
          <div class="flex flex-col gap-0.5">
            <div class="flex min-w-56 items-center gap-1">
              <code class="min-w-0 flex-1 truncate font-mono text-sm text-toned">
                {{ revealedCodes[row.original.id] || row.original.codePreview }}
              </code>
              <UTooltip
                :text="$t(revealedCodes[row.original.id]
                  ? 'admin.credits.redemptionCodes.actions.hideCode'
                  : 'admin.credits.redemptionCodes.actions.viewCode')"
              >
                <UButton
                  :icon="revealedCodes[row.original.id]
                    ? 'i-mdi-eye-off-outline'
                    : 'i-mdi-eye-outline'"
                  :loading="revealingCodeIds.has(row.original.id)"
                  :aria-label="$t(revealedCodes[row.original.id]
                    ? 'admin.credits.redemptionCodes.actions.hideCode'
                    : 'admin.credits.redemptionCodes.actions.viewCode')"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="toggleCodeVisibility(row.original)"
                />
              </UTooltip>
              <UTooltip
                v-if="revealedCodes[row.original.id]"
                :text="$t('admin.credits.redemptionCodes.actions.copyCode')"
              >
                <UButton
                  icon="i-lucide-copy"
                  :aria-label="$t('admin.credits.redemptionCodes.actions.copyCode')"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  @click="copyOne(revealedCodes[row.original.id] || '')"
                />
              </UTooltip>
            </div>
            <span
              v-if="row.original.batchId"
              class="text-xs text-muted font-mono"
            >
              {{ row.original.batchId }}
            </span>
          </div>
        </template>
        <template #amount-cell="{ row }">
          <span class="tabular-nums font-semibold text-success">+{{ row.original.amount.toLocaleString(locale) }}</span>
        </template>
        <template #usage-cell="{ row }">
          <span class="tabular-nums text-sm">{{ row.original.usedCount }} / {{ row.original.maxUses }}</span>
        </template>
        <template #note-cell="{ row }">
          <span class="text-xs text-muted truncate max-w-[200px] block">{{ row.original.note || '-' }}</span>
        </template>
        <template #expiresAt-cell="{ row }">
          <span class="text-xs text-muted whitespace-nowrap">
            {{ row.original.expiresAt
              ? formatDateTime(row.original.expiresAt, '-', locale)
              : $t('admin.credits.redemptionCodes.neverExpires') }}
          </span>
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="statusOf(row.original).color"
            variant="subtle"
          >
            {{ statusOf(row.original).label }}
          </UBadge>
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-xs text-muted whitespace-nowrap">{{ formatDateTime(row.original.createdAt, '-', locale) }}</span>
        </template>
        <template #actions-cell="{ row }">
          <div class="text-right">
            <UDropdownMenu
              :items="getRowItems(row.original)"
              :content="{ align: 'end' }"
            >
              <UButton
                icon="i-mdi-dots-vertical"
                :aria-label="$t('admin.credits.redemptionCodes.actions.more', { id: row.original.id })"
                color="neutral"
                variant="ghost"
                size="sm"
              />
            </UDropdownMenu>
          </div>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>

    <LazyAdminRedemptionCodeGenerateModal
      v-if="generateOpen"
      v-model:open="generateOpen"
      :on-generate="generate"
      :on-copy-one="copyOne"
      :on-copy-all="copyAll"
    />
  </div>
</template>
