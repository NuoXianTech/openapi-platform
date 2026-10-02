import type { TableColumn } from '@nuxt/ui'
import { computed } from 'vue'
import type { AdminLoginLogRow, LoginMethod } from '#shared/types/login-log'
import { useDebouncedListKeyword } from '~/composables/dashboard/use-debounced-list-keyword'
import { usePrivatePagedList, type PrivatePagedPagination } from '~/composables/dashboard/use-private-paged-list'
import { useLoginLogMeta } from '~/composables/use-login-log-meta'
import { useAdminLogCleanup } from '~/composables/admin/use-admin-log-cleanup'

interface AdminLoginLogFilters {
  keyword: string
  startAt: string
  endAt: string
  method: 'all' | LoginMethod
  success: 'all' | 'success' | 'failure'
  userId: number | ''
}

const ADMIN_LOGIN_LOG_DEFAULT_FILTERS: AdminLoginLogFilters = {
  keyword: '',
  startAt: '',
  endAt: '',
  method: 'all',
  success: 'all',
  userId: ''
}

function optionalDateIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}

function buildAdminLoginLogRequestFilters(filters: AdminLoginLogFilters) {
  return {
    keyword: filters.keyword.trim() || undefined,
    startAt: optionalDateIso(filters.startAt),
    endAt: optionalDateIso(filters.endAt),
    method: filters.method === 'all' ? undefined : filters.method,
    success: filters.success === 'all'
      ? undefined
      : filters.success === 'success',
    userId: filters.userId || undefined
  }
}

function buildAdminLoginLogQuery(
  filters: AdminLoginLogFilters,
  pagination: PrivatePagedPagination
): Record<string, unknown> {
  const requestFilters = buildAdminLoginLogRequestFilters(filters)
  return {
    ...requestFilters,
    success: requestFilters.success === undefined
      ? undefined
      : requestFilters.success ? 'success' : 'failure',
    limit: pagination.limit,
    offset: pagination.offset
  }
}

export function useAdminLoginLogList(options: { immediate?: boolean } = {}) {
  const { t } = useI18n()
  const {
    getLoginMethodColor,
    getLoginMethodIcon,
    getLoginMethodLabel
  } = useLoginLogMeta()
  const list = usePrivatePagedList<AdminLoginLogFilters, AdminLoginLogRow>({
    path: '/api/admin/login-logs/list',
    defaultFilters: ADMIN_LOGIN_LOG_DEFAULT_FILTERS,
    immediate: options.immediate ?? true,
    buildQuery: buildAdminLoginLogQuery
  })
  const keywordApply = useDebouncedListKeyword(
    () => list.filters.keyword,
    list.applyFilters
  )
  const cleanup = useAdminLogCleanup({
    endpoint: '/api/admin/login-logs/cleanup',
    applyFilters: keywordApply.applyNow,
    refresh: list.refresh,
    buildFilters: () => buildAdminLoginLogRequestFilters(list.filters)
  })

  const advancedFilterCount = computed(() => [
    list.filters.method !== 'all',
    list.filters.success !== 'all',
    list.filters.userId !== ''
  ].filter(Boolean).length)
  const methodItems = computed(() => [
    { label: t('admin.logs.login.filters.allMethods'), value: 'all' as const },
    { label: getLoginMethodLabel('password'), value: 'password' as const },
    { label: getLoginMethodLabel('oauth_github'), value: 'oauth_github' as const },
    { label: getLoginMethodLabel('oauth_qq'), value: 'oauth_qq' as const }
  ])
  const successItems = computed(() => [
    { label: t('admin.logs.login.filters.allResults'), value: 'all' as const },
    { label: t('common.states.success'), value: 'success' as const },
    { label: t('common.states.failure'), value: 'failure' as const }
  ])
  const columns = computed<TableColumn<AdminLoginLogRow>[]>(() => [
    { accessorKey: 'createdAt', header: t('admin.logs.login.columns.time') },
    { id: 'user', header: t('admin.logs.login.columns.user') },
    { accessorKey: 'method', header: t('admin.logs.login.columns.method') },
    { accessorKey: 'success', header: t('admin.logs.login.columns.result') },
    { accessorKey: 'device', header: t('admin.logs.login.columns.device') },
    { accessorKey: 'ip', header: 'IP' }
  ])

  async function reset() {
    await list.reset()
    keywordApply.markApplied()
  }

  return {
    advancedFilterCount,
    applyFilters: keywordApply.applyNow,
    columns,
    filters: list.filters,
    items: list.items,
    loading: list.loading,
    methodColor: getLoginMethodColor,
    methodIcon: getLoginMethodIcon,
    methodItems,
    page: list.page,
    pageSize: list.pageSize,
    refresh: list.refresh,
    reset,
    successItems,
    total: list.total,
    ...cleanup
  }
}
