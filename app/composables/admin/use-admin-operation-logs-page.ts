import type { TableColumn } from '@nuxt/ui'
import { computed, ref } from 'vue'
import { auditActionMessageKey } from '#shared/config/audit-actions'
import { useDebouncedListKeyword } from '~/composables/dashboard/use-debounced-list-keyword'
import { usePrivatePagedList, type PrivatePagedPagination } from '~/composables/dashboard/use-private-paged-list'
import { useAdminLogCleanup } from '~/composables/admin/use-admin-log-cleanup'

interface AdminOperationLogRow {
  id: number
  userId: number | null
  actorRole: 'user' | 'admin' | null
  actor: string | null
  action: string
  resourceType: string | null
  resourceId: string | null
  ip: string | null
  userAgent: string | null
  detail: Record<string, unknown> | null
  status: 'success' | 'failure'
  createdAt: string
}

interface AdminOperationLogFilters extends Record<string, unknown> {
  keyword: string
  startAt: string
  endAt: string
  userId: number | ''
  actorKind: 'all' | 'admin' | 'user'
  actor: string
  action: string
  resourceType: string
  status: 'all' | 'success' | 'failure'
}

const ADMIN_OPERATION_LOG_DEFAULT_FILTERS: AdminOperationLogFilters = {
  keyword: '',
  startAt: '',
  endAt: '',
  userId: '',
  actorKind: 'all',
  actor: '',
  action: '',
  resourceType: '',
  status: 'all'
}

function optionalDateIso(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined
}

function trimmedOrUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

function buildAdminOperationLogRequestFilters(filters: AdminOperationLogFilters) {
  return {
    keyword: trimmedOrUndefined(filters.keyword),
    startAt: optionalDateIso(filters.startAt),
    endAt: optionalDateIso(filters.endAt),
    userId: filters.userId || undefined,
    actorKind: filters.actorKind === 'all' ? undefined : filters.actorKind,
    actor: trimmedOrUndefined(filters.actor),
    action: trimmedOrUndefined(filters.action),
    resourceType: trimmedOrUndefined(filters.resourceType),
    status: filters.status === 'all' ? undefined : filters.status
  }
}

function buildAdminOperationLogQuery(
  filters: AdminOperationLogFilters,
  pagination: PrivatePagedPagination
): Record<string, unknown> {
  return {
    ...buildAdminOperationLogRequestFilters(filters),
    limit: pagination.limit,
    offset: pagination.offset
  }
}

function stringifyOperationLogDetail(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return ''
  try {
    return JSON.stringify(detail, null, 2)
  } catch {
    return String(detail)
  }
}

export function resolveOperationLogActorKind(
  action: string,
  userId: number | null,
  actorRole: AdminOperationLogRow['actorRole'] = null
): 'admin' | 'user' | 'system' {
  if (actorRole === 'admin' || (!actorRole && action.startsWith('admin.'))) return 'admin'
  if (actorRole === 'user' || (!actorRole && action.startsWith('user.')) || userId) return 'user'
  return 'system'
}

export function useAdminOperationLogList(options: { immediate?: boolean } = {}) {
  const { t, te } = useI18n()
  const list = usePrivatePagedList<AdminOperationLogFilters, AdminOperationLogRow>({
    path: '/api/admin/operation-logs/list',
    defaultFilters: ADMIN_OPERATION_LOG_DEFAULT_FILTERS,
    immediate: options.immediate ?? true,
    buildQuery: buildAdminOperationLogQuery
  })
  const keywordApply = useDebouncedListKeyword(
    () => list.filters.keyword,
    list.applyFilters
  )
  const cleanup = useAdminLogCleanup({
    endpoint: '/api/admin/operation-logs/cleanup',
    applyFilters: keywordApply.applyNow,
    refresh: list.refresh,
    buildFilters: () => buildAdminOperationLogRequestFilters(list.filters)
  })

  const advancedFilterCount = computed(() => [
    list.filters.userId !== '',
    list.filters.actorKind !== 'all',
    list.filters.actor.trim() !== '',
    list.filters.action.trim() !== '',
    list.filters.resourceType.trim() !== '',
    list.filters.status !== 'all'
  ].filter(Boolean).length)
  const detailRow = ref<AdminOperationLogRow | null>(null)
  const detailOpen = ref(false)
  const detailJson = computed(() => stringifyOperationLogDetail(detailRow.value?.detail))
  const actorKindItems = computed(() => [
    { label: t('admin.logs.operations.filters.allSources'), value: 'all' as const },
    { label: t('admin.logs.operations.filters.adminActions'), value: 'admin' as const },
    { label: t('admin.logs.operations.filters.userActions'), value: 'user' as const }
  ])
  const statusItems = computed(() => [
    { label: t('admin.logs.operations.filters.allStatuses'), value: 'all' as const },
    { label: t('common.states.success'), value: 'success' as const },
    { label: t('common.states.failure'), value: 'failure' as const }
  ])
  const columns = computed<TableColumn<AdminOperationLogRow>[]>(() => [
    { accessorKey: 'createdAt', header: t('admin.logs.operations.columns.time') },
    { id: 'actor', header: t('admin.logs.operations.columns.actor') },
    { accessorKey: 'action', header: t('admin.logs.operations.columns.action') },
    { id: 'resource', header: t('admin.logs.operations.columns.resource') },
    { accessorKey: 'status', header: t('admin.logs.operations.columns.status') },
    { accessorKey: 'ip', header: 'IP' },
    { id: 'actions', header: '' }
  ])

  function resolveActorLabel(
    action: string,
    userId: number | null,
    actorRole: AdminOperationLogRow['actorRole'] = null
  ): string {
    const actorKind = resolveOperationLogActorKind(action, userId, actorRole)
    if (actorKind === 'admin') {
      return userId
        ? t('common.identities.adminWithId', { id: userId })
        : t('common.identities.admin')
    }
    if (actorKind === 'user') {
      return userId
        ? t('common.identities.userWithId', { id: userId })
        : t('common.identities.user')
    }
    return t('common.identities.system')
  }

  function resolveActionLabel(action: string): string {
    const messageKey = auditActionMessageKey(action)
    return te(messageKey) ? t(messageKey) : action
  }

  function openDetail(row: AdminOperationLogRow) {
    detailRow.value = row
    detailOpen.value = true
  }

  async function reset() {
    await list.reset()
    keywordApply.markApplied()
  }

  return {
    actorKindItems,
    advancedFilterCount,
    applyFilters: keywordApply.applyNow,
    columns,
    detailJson,
    detailOpen,
    detailRow,
    filters: list.filters,
    items: list.items,
    loading: list.loading,
    openDetail,
    page: list.page,
    pageSize: list.pageSize,
    refresh: list.refresh,
    reset,
    resolveActorLabel,
    resolveActionLabel,
    statusItems,
    total: list.total,
    ...cleanup
  }
}
