import type { AsyncDataRequestStatus } from '#app'
import {
  onMounted,
  reactive,
  ref,
  watch,
  type ComputedRef,
  type Ref
} from 'vue'
import { usePrivateResource, type PrivateReadResult } from '~/composables/dashboard/use-private-resource'
import { DEFAULT_PAGE_SIZE } from '~/constants/pagination'

export interface PrivatePagedPagination {
  page: number
  limit: number
  offset: number
}

interface UsePrivatePagedListOptions<TFilters extends object> {
  path: string
  defaultFilters: TFilters
  defaultPageSize?: number
  // 默认 true：组件挂载后（仅客户端）自动拉首屏；false 时需调用方自行触发 refresh / applyFilters。
  immediate?: boolean
  // 与 useDashboardListState 配合时可传入外部状态，确保筛选、分页和 URL 查询只有一份来源。
  filters?: TFilters
  page?: Ref<number>
  pageSize?: Ref<number>
  // 把 filters + 分页拼成最终 query；缺省直接展开 filters 并附加 limit/offset。
  buildQuery?: (filters: TFilters, pagination: PrivatePagedPagination) => Record<string, unknown>
  timeoutMs?: number
}

interface UsePrivatePagedListReturn<TFilters, TItem> {
  filters: TFilters
  page: Ref<number>
  pageSize: Ref<number>
  items: Ref<TItem[]>
  total: Ref<number>
  status: Ref<AsyncDataRequestStatus>
  loading: ComputedRef<boolean>
  error: Ref<unknown>
  refresh: () => Promise<PrivateReadResult<{ items: TItem[], total: number }>>
  applyFilters: () => Promise<PrivateReadResult<{ items: TItem[], total: number }>>
  reset: () => Promise<PrivateReadResult<{ items: TItem[], total: number }>>
}

/**
 * 私有（登录态 / per-user / 后台敏感）分页列表的统一封装：filters + page + pageSize → query → 拉取。
 *
 * 关键约定 —— 用 $fetch 而非 useFetch / useLazyFetch：后者经 useAsyncData 把响应写进 nuxt payload，
 * 会让私有数据进入可被上游缓存的 HTML（见 feedback_nuxt_ssr_private_state）。这里：
 *   1. 用普通 ref 存状态，响应永不进 payload；
 *   2. 仅客户端（onMounted）触发拉取，SSR 阶段只渲染 loading 占位，HTML 里没有任何数据行；
 *   3. immediate 时 status 初值即 'pending'，让 SSR 首帧直接渲染 loading 而非空态，避免客户端补拉前的空态闪烁。
 *
 * 故意保留 watch:false 语义（不监听 filters）：输入框逐字符不触发查询，由 applyFilters / reset 显式刷新；
 * 翻页通过 watch(page) 触发。并发或快慢乱序时用 requestSeq 只采用最新一次结果，旧响应直接丢弃。
 */
export function usePrivatePagedList<
  TFilters extends object,
  TItem = unknown
>(options: UsePrivatePagedListOptions<TFilters>): UsePrivatePagedListReturn<TFilters, TItem> {
  const {
    path,
    defaultFilters,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    immediate = true,
    filters: externalFilters,
    page: externalPage,
    pageSize: externalPageSize,
    buildQuery,
    timeoutMs = 15_000
  } = options

  const filters = externalFilters ?? (reactive({ ...defaultFilters }) as TFilters)
  const page = externalPage ?? ref(1)
  const pageSize = externalPageSize ?? ref(defaultPageSize)
  const items = ref<TItem[]>([]) as Ref<TItem[]>
  const total = ref(0)
  const resource = usePrivateResource<{ items: TItem[], total: number }>({
    path,
    defaultData: () => ({ items: [], total: 0 }),
    immediate: false,
    timeoutMs,
    resetOnError: true,
    query: () => {
      const limit = pageSize.value
      const offset = (page.value - 1) * limit
      return buildQuery ? buildQuery(filters, { page: page.value, limit, offset }) : { ...filters, limit, offset }
    },
    validate(value) {
      const result = value as { items?: unknown, total?: unknown } | null
      if (!result || !Array.isArray(result.items) || !Number.isFinite(result.total)) {
        throw new TypeError(`Invalid paged response from ${path}`)
      }
    }
  })
  const { status, loading, error } = resource
  status.value = immediate ? 'pending' : 'idle'
  let skipNextPageRefresh = false

  function resetPageWithoutAutoRefresh() {
    if (page.value === 1) return
    skipNextPageRefresh = true
    page.value = 1
  }

  async function refresh(): Promise<PrivateReadResult<{ items: TItem[], total: number }>> {
    const result = await resource.refresh()
    if (resource.disposed.value) return { status: 'disposed' }
    if (result.status === 'error') {
      if (error.value !== result.error || status.value !== 'error') return { status: 'superseded' }
      items.value = []
      total.value = 0
      return result
    }
    if (result.status !== 'success') return result
    if (resource.data.value !== result.data || status.value !== 'success') return { status: 'superseded' }
    const lastPage = Math.max(1, Math.ceil(result.data.total / pageSize.value))
    if (page.value > lastPage) {
      skipNextPageRefresh = true
      page.value = lastPage
      return refresh()
    }
    items.value = result.data.items
    total.value = result.data.total
    return result
  }

  async function applyFilters() {
    if (resource.disposed.value) return { status: 'disposed' } as const
    resetPageWithoutAutoRefresh()
    return refresh()
  }

  async function reset() {
    if (resource.disposed.value) return { status: 'disposed' } as const
    Object.assign(filters, defaultFilters)
    resetPageWithoutAutoRefresh()
    return refresh()
  }

  watch(page, () => {
    if (skipNextPageRefresh) {
      skipNextPageRefresh = false
      return
    }
    void refresh()
  })

  watch(pageSize, () => {
    resetPageWithoutAutoRefresh()
    void refresh()
  })

  if (immediate) {
    // onMounted 天然只在客户端触发，保证私有数据不在 SSR 阶段拉取 / 落入 HTML。
    onMounted(() => { void refresh() })
  }
  return {
    filters,
    page,
    pageSize,
    items,
    total,
    status,
    loading,
    error,
    refresh,
    applyFilters,
    reset
  }
}
