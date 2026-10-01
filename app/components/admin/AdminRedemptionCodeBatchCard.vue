<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import type { BatchSummary } from '~/composables/admin/use-redemption-codes-page'

defineProps<{
  batches: BatchSummary[]
}>()

const emit = defineEmits<{
  filter: [batchId: string]
  toggle: [batchId: string, enabled: boolean]
  delete: [batchId: string, includeUsed: boolean]
}>()
const { t, locale } = useI18n()

function getBatchMenuItems(batch: BatchSummary): DropdownMenuItem[][] {
  return [[
    {
      label: t('admin.credits.redemptionCodes.batch.actions.filter'),
      icon: 'i-mdi-filter-variant',
      onSelect: () => emit('filter', batch.batchId)
    },
    {
      label: t('admin.credits.redemptionCodes.batch.actions.disable'),
      icon: 'i-mdi-toggle-switch-off-outline',
      onSelect: () => emit('toggle', batch.batchId, false)
    },
    {
      label: t('admin.credits.redemptionCodes.batch.actions.enable'),
      icon: 'i-mdi-toggle-switch-outline',
      onSelect: () => emit('toggle', batch.batchId, true)
    }
  ], [
    {
      label: t('admin.credits.redemptionCodes.batch.actions.deleteUnused'),
      icon: 'i-mdi-delete-outline',
      onSelect: () => emit('delete', batch.batchId, false)
    },
    {
      label: t('admin.credits.redemptionCodes.batch.actions.deleteAll'),
      icon: 'i-mdi-delete-alert-outline',
      color: 'error',
      onSelect: () => emit('delete', batch.batchId, true)
    }
  ]]
}
</script>

<template>
  <DashboardContentCard
    v-if="batches.length > 0"
    :title="$t('admin.credits.redemptionCodes.batch.title')"
    icon="i-mdi-package-variant"
  >
    <template #actions>
      <span class="text-xs text-muted">
        {{ $t('admin.credits.redemptionCodes.batch.count', { count: batches.length.toLocaleString(locale) }) }}
      </span>
    </template>
    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <div
        v-for="b in batches.slice(0, 8)"
        :key="b.batchId"
        class="rounded-lg border border-default p-3 bg-elevated/30"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="font-mono text-xs text-muted truncate">
            {{ b.batchId }}
          </span>
          <UDropdownMenu
            :items="getBatchMenuItems(b)"
          >
            <UButton
              icon="i-mdi-dots-vertical"
              :aria-label="$t('admin.credits.redemptionCodes.batch.actions.more', { batchId: b.batchId })"
              size="xs"
              variant="ghost"
              color="neutral"
            />
          </UDropdownMenu>
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-xl font-semibold tabular-nums text-success">
            +{{ b.amount.toLocaleString(locale) }}
          </span>
          <span class="text-xs text-muted">{{ $t('admin.credits.redemptionCodes.batch.perCode') }}</span>
        </div>
        <div class="mt-2 flex items-center justify-between text-xs text-muted">
          <span>{{ $t('admin.credits.redemptionCodes.batch.total', { count: b.total.toLocaleString(locale) }) }}</span>
          <span class="tabular-nums">
            {{ $t('admin.credits.redemptionCodes.batch.usage', {
              used: b.usedTotal.toLocaleString(locale),
              total: b.maxUsesTotal.toLocaleString(locale)
            }) }}
          </span>
        </div>
        <UTooltip
          v-if="b.note"
          :text="b.note"
          :content="{ side: 'top' }"
        >
          <div class="mt-1 text-xs text-muted truncate">
            {{ b.note }}
          </div>
        </UTooltip>
      </div>
    </div>
  </DashboardContentCard>
</template>
