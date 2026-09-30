<script setup lang="ts" generic="T">
import type { TableColumn } from '@nuxt/ui'

interface DashboardDataTableProps<T> {
  data: T[]
  columns: TableColumn<T>[]
  loading?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: string
  page?: number
  pageSize?: number
  total?: number
  /** 传入后底部显示“每页条数”下拉（配合 v-model:page-size） */
  pageSizeOptions?: number[]
  /** 行选择状态（配合 v-model:row-selection）；不传则禁用行选择 */
  rowSelection?: Record<string, boolean>
  /** 列可见性状态（配合 v-model:column-visibility）；不传则全部列可见 */
  columnVisibility?: Record<string, boolean>
  /** 行唯一 id 取值函数（启用行选择时建议提供） */
  getRowId?: (row: T) => string
  /** 列宽算法：true=table-fixed 等宽（默认）；列多/内容宽的表传 false 走自动列宽 */
  fixed?: boolean
  /** 首屏空数据加载时的骨架行数 */
  skeletonRows?: number
  /** 覆盖默认表格 :ui（与组件内置样式浅合并） */
  ui?: Record<string, string>
}

interface DashboardDataTableEmits {
  'update:page': [value: number]
  'update:pageSize': [value: number]
  'update:rowSelection': [value: Record<string, boolean>]
  'update:columnVisibility': [value: Record<string, boolean>]
}

const {
  data,
  columns,
  loading = false,
  emptyTitle,
  emptyIcon = 'i-mdi-inbox-outline',
  page = 1,
  pageSize = 0,
  total = 0,
  pageSizeOptions,
  rowSelection,
  columnVisibility,
  getRowId,
  fixed = true,
  skeletonRows = 8,
  ui
} = defineProps<DashboardDataTableProps<T>>()

const emit = defineEmits<DashboardDataTableEmits>()
const { t, locale } = useI18n()

// 后台表格统一外观：中性灰阶、稳定字号与紧凑行高。
const DEFAULT_TABLE_UI = {
  base: 'dashboard-table-native table-fixed border-separate border-spacing-0',
  thead: '[&>tr]:[background-color:var(--dashboard-table-header)] [&>tr]:after:content-none',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  th: 'h-10 px-4 py-2 text-xs font-medium tracking-normal text-muted border-b border-default',
  td: 'px-4 py-3 text-sm leading-5 text-default border-b border-default [background-color:var(--dashboard-table-row)]',
  empty: 'py-9 border-b border-muted rounded-b-md [background-color:var(--dashboard-table-row)]',
  separator: 'h-0'
}
const tableUi = computed(() => ({
  ...DEFAULT_TABLE_UI,
  base: fixed ? DEFAULT_TABLE_UI.base : 'dashboard-table-native border-separate border-spacing-0',
  ...ui
}))

const hasPageSizeSelect = computed(() => !!pageSizeOptions?.length)
const localizedPageSizeItems = computed(() => pageSizeOptions?.map(value => ({
  value,
  label: t('common.pagination.perPage', { count: value })
})))
const showSkeleton = computed(() => loading && data.length === 0)
// 只要页面提供了“每页条数”，分页控件就是列表操作的一部分：即使当前只有一页，
// 也保留禁用态的首页 / 上一页 / 下一页 / 末页，避免不同列表的底部结构忽隐忽现。
const showPagination = computed(() => pageSize > 0 && total > 0 && (
  hasPageSizeSelect.value || total > pageSize
))
const skeletonColumnCount = computed(() => Math.max(columns.length || 0, 3))

function skeletonWidth(rowIndex: number, columnIndex: number) {
  const widths = ['72%', '48%', '84%', '56%', '66%', '38%', '76%', '52%']
  return widths[(rowIndex + columnIndex) % widths.length]
}

function onPageSizeChange(value: string | number) {
  emit('update:pageSize', Number(value))
}

function onRowSelectionChange(value: Record<string, boolean> | undefined) {
  emit('update:rowSelection', value ?? {})
}

function onColumnVisibilityChange(value: Record<string, boolean> | undefined) {
  emit('update:columnVisibility', value ?? {})
}
</script>

<template>
  <div class="dashboard-data-table flex flex-col">
    <div
      v-if="showSkeleton"
      class="dashboard-table-skeleton overflow-hidden rounded-md"
    >
      <div class="grid gap-0">
        <div
          class="grid border-b border-default [background-color:var(--dashboard-table-header)]"
          :style="{ gridTemplateColumns: `repeat(${skeletonColumnCount}, minmax(0, 1fr))` }"
        >
          <div
            v-for="columnIndex in skeletonColumnCount"
            :key="`header-${columnIndex}`"
            class="px-4 py-2"
          >
            <div
              class="dashboard-skeleton h-3 rounded-sm"
              :style="{ width: skeletonWidth(0, columnIndex) }"
            />
          </div>
        </div>
        <div
          v-for="rowIndex in skeletonRows"
          :key="rowIndex"
          class="grid border-b border-default last:border-b-0"
          :style="{ gridTemplateColumns: `repeat(${skeletonColumnCount}, minmax(0, 1fr))` }"
        >
          <div
            v-for="columnIndex in skeletonColumnCount"
            :key="`${rowIndex}-${columnIndex}`"
            class="px-4 py-3"
          >
            <div
              class="dashboard-skeleton h-4 rounded-sm"
              :style="{ width: skeletonWidth(rowIndex, columnIndex) }"
            />
          </div>
        </div>
      </div>
    </div>

    <UTable
      v-else
      class="min-w-full"
      :data="data"
      :columns="columns"
      :loading="loading"
      :ui="tableUi"
      :row-selection="rowSelection"
      :column-visibility="columnVisibility"
      :get-row-id="getRowId"
      @update:row-selection="onRowSelectionChange"
      @update:column-visibility="onColumnVisibilityChange"
    >
      <template #empty>
        <div class="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center">
          <UIcon
            :name="emptyIcon"
            class="size-7 text-muted"
          />
          <div>
            <p class="text-sm font-medium text-highlighted">
              {{ emptyTitle || t('common.table.empty') }}
            </p>
            <p
              v-if="emptyDescription"
              class="mt-1 text-sm text-muted"
            >
              {{ emptyDescription }}
            </p>
          </div>
          <div
            v-if="$slots['empty-actions']"
            class="mt-1"
          >
            <slot name="empty-actions" />
          </div>
        </div>
      </template>

      <template
        v-for="(_, name) in $slots"
        :key="name"
        #[name]="slotData"
      >
        <slot
          :name="name"
          v-bind="slotData ?? {}"
        />
      </template>
    </UTable>

    <div
      v-if="showPagination"
      class="dashboard-table-pagination flex flex-col gap-3 border-t border-default px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-start">
        <span class="text-xs text-muted tabular-nums">
          {{ t('common.pagination.totalRecords', { count: total.toLocaleString(locale) }) }}
        </span>
        <USelect
          v-if="hasPageSizeSelect"
          :model-value="pageSize"
          :items="localizedPageSizeItems"
          value-key="value"
          size="sm"
          class="w-24"
          @update:model-value="onPageSizeChange"
        />
      </div>
      <UPagination
        :page="page"
        :items-per-page="pageSize"
        :total="total"
        :sibling-count="1"
        show-edges
        size="sm"
        class="max-w-full self-end sm:self-auto"
        :ui="{ first: 'hidden', last: 'hidden', list: 'gap-0.5 sm:gap-1' }"
        @update:page="emit('update:page', $event)"
      />
    </div>
  </div>
</template>
