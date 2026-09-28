import type { TableColumn } from '@nuxt/ui'
import { computed, ref, type MaybeRefOrGetter } from 'vue'
import {
  ADMIN_LOG_TYPES,
  type AdminLogRow,
  type AdminLogType,
  type AdminLogsFilterOptions
} from '#shared/types/admin'
import {
  createNumberQueryCodec,
  createStringArrayQueryCodec,
  createStringQueryCodec,
  type DashboardQueryCodec,
  useDashboardListState
} from '~/composables/dashboard/use-dashboard-list-state'
import { useDebouncedListKeyword } from '~/composables/dashboard/use-debounced-list-keyword'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'
import { useAdminLogCleanup } from '~/composables/admin/use-admin-log-cleanup'

interface AdminCallLogsFilters {
  keyword: string
  startAt: string
  endAt: string
  routeId: string
  categoryId: number
  types: AdminLogType[]
  apiKeyId: number | ''
  userId: number | ''
  requestId: string
}

interface UseAdminCallLogsPageOptions {
  immediate?: boolean
  replaceQuery?: (query: Record<string, string | number>) => void | Promise<void>
  routeQuery?: MaybeRefOrGetter<Record<string, unknown>>
}

const ADMIN_CALL_LOG_DEFAULT_FILTERS: AdminCallLogsFilters = {
  keyword: '',
  startAt: '',
  endAt: '',
  routeId: '',
  categoryId: 0,
  types: [],
  apiKeyId: '',
  userId: '',
  requestId: ''
}

function buildAdminCallLogRequestFilters(filters: AdminCallLogsFilters) {
  return {
    keyword: filters.keyword.trim() || undefined,
    startAt: filters.startAt ? new Date(filters.startAt).toISOString() : undefined,
    endAt: filters.endAt ? new Date(filters.endAt).toISOString() : undefined,
    routeId: filters.routeId || undefined,
    categoryId: filters.categoryId || undefined,
    types: filters.types.length === 1 ? [...filters.types] : undefined,
    apiKeyId: filters.apiKeyId || undefined,
    userId: filters.userId || undefined,
    requestId: filters.requestId.trim() || undefined
  }
}

export const ADMIN_CALL_LOG_TYPE_META: Record<AdminLogType, {
  messageKey: string
  color: 'success' | 'error' | 'primary'
  icon: string
}> = {
  consume: {
    messageKey: 'admin.logs.call.types.request',
    color: 'primary',
    icon: 'i-mdi-swap-horizontal-circle-outline'
  },
  error: {
    messageKey: 'admin.logs.call.types.error',
    color: 'error',
    icon: 'i-mdi-alert-circle-outline'
  }
}

function createOptionalNumberQueryCodec(): DashboardQueryCodec<number | ''> {
  return {
    parse(value) {
      const raw = Array.isArray(value) ? value[0] : value
      const parsed = Number(raw)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : ''
    },
    serialize(value) {
      return typeof value === 'number' && value > 0 ? value : undefined
    }
  }
}

export function useAdminCallLogsPage(options: UseAdminCallLogsPageOptions = {}) {
  const { t } = useI18n()
  const filterOptions = ref<AdminLogsFilterOptions>({ routes: [], categories: [] })
  const listState = useDashboardListState<AdminCallLogsFilters>({
    defaultFilters: ADMIN_CALL_LOG_DEFAULT_FILTERS,
    routeQuery: options.routeQuery,
    replaceQuery: options.replaceQuery,
    filterCodecs: {
      keyword: createStringQueryCodec(''),
      startAt: createStringQueryCodec(''),
      endAt: createStringQueryCodec(''),
      routeId: createStringQueryCodec(''),
      categoryId: createNumberQueryCodec(0),
      types: createStringArrayQueryCodec<AdminLogType>([], ADMIN_LOG_TYPES),
      apiKeyId: createOptionalNumberQueryCodec(),
      userId: createOptionalNumberQueryCodec(),
      requestId: createStringQueryCodec('')
    }
  })

  const list = usePrivatePagedList<AdminCallLogsFilters, AdminLogRow>({
    path: '/api/admin/logs/list',
    defaultFilters: ADMIN_CALL_LOG_DEFAULT_FILTERS,
    filters: listState.filters,
    page: listState.page,
    pageSize: listState.pageSize,
    immediate: options.immediate ?? true,
    buildQuery: (filters, pagination) => {
      const requestFilters = buildAdminCallLogRequestFilters(filters)
      return {
        ...requestFilters,
        types: requestFilters.types?.join(','),
        limit: pagination.limit,
        offset: pagination.offset
      }
    }
  })

  async function applyListFilters() {
    const result = await list.applyFilters()
    await listState.syncQuery()
    return result
  }

  const keywordApply = useDebouncedListKeyword(
    () => listState.filters.keyword,
    applyListFilters
  )
  const cleanup = useAdminLogCleanup({
    endpoint: '/api/admin/logs/cleanup',
    total: list.total,
    applyFilters: keywordApply.applyNow,
    refresh: list.refresh,
    buildFilters: () => buildAdminCallLogRequestFilters(listState.filters)
  })
  const typeSelectItems = computed(() => ADMIN_LOG_TYPES.map(type => ({
    label: t(ADMIN_CALL_LOG_TYPE_META[type].messageKey),
    value: type,
    icon: ADMIN_CALL_LOG_TYPE_META[type].icon
  })))
  const apiSelectItems = computed(() => [
    { label: t('admin.logs.call.filters.allApis'), value: '' },
    ...filterOptions.value.routes.map(route => ({ label: `${route.name}（${route.apiPath}）`, value: route.id }))
  ])
  const categorySelectItems = computed(() => [
    { label: t('admin.logs.call.filters.allCategories'), value: 0 },
    ...filterOptions.value.categories.map(category => ({ label: category.name, value: category.id }))
  ])
  const advancedFilterCount = computed(() => [
    listState.filters.routeId !== '',
    listState.filters.categoryId !== 0,
    listState.filters.types.length > 0,
    listState.filters.apiKeyId !== '',
    listState.filters.userId !== '',
    listState.filters.requestId.trim() !== ''
  ].filter(Boolean).length)
  const columns = computed<TableColumn<AdminLogRow>[]>(() => [
    { accessorKey: 'createdAt', header: t('admin.logs.call.columns.time') },
    { accessorKey: 'userName', header: t('admin.logs.call.columns.user') },
    { accessorKey: 'apiKeyName', header: t('admin.logs.call.columns.key') },
    { accessorKey: 'apiName', header: t('admin.logs.call.columns.api') },
    { accessorKey: 'cost', header: t('admin.logs.call.columns.cost') },
    { id: 'summary', header: t('admin.logs.call.columns.summary') },
    { id: 'actions', header: '' }
  ])

  async function loadFilterOptions() {
    try {
      filterOptions.value = await $fetch<AdminLogsFilterOptions>('/api/admin/logs/filters')
        || { routes: [], categories: [] }
    } catch {
      filterOptions.value = { routes: [], categories: [] }
    }
  }

  async function resetFilters() {
    await list.reset()
    keywordApply.markApplied()
    await listState.syncQuery()
  }

  return {
    filters: listState.filters,
    page: listState.page,
    pageSize: listState.pageSize,
    items: list.items,
    total: list.total,
    loading: list.loading,
    refresh: list.refresh,
    applyFilters: keywordApply.applyNow,
    resetFilters,
    filterOptions,
    typeSelectItems,
    apiSelectItems,
    categorySelectItems,
    advancedFilterCount,
    columns,
    loadFilterOptions,
    ...cleanup
  }
}
