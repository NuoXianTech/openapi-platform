import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import { useAdminEndpointCatalogOperations } from '~/composables/admin/use-admin-endpoint-catalog-operations'
import type {
  PlatformEndpointCatalog,
  PlatformEndpointCatalogItem,
  PlatformRouteBinding
} from '#shared/types/platform'

function emptyCatalog(): PlatformEndpointCatalog {
  return {
    activeRevisionId: null,
    activeRevisionSequence: null,
    services: [],
    totals: {
      discovered: 0,
      live: 0,
      available: 0,
      pending: 0,
      disabled: 0,
      driftedTargets: 0
    }
  }
}

export function useAdminEndpointCatalogPage() {
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const catalogResource = usePrivateResource<PlatformEndpointCatalog>({
    path: '/api/admin/v1/service-endpoints',
    defaultData: emptyCatalog
  })
  const search = ref('')
  const statusFilter = ref('all')
  const routeModalOpen = ref(false)
  const editingRoute = ref<PlatformRouteBinding | null>(null)

  const catalog = computed(() => catalogResource.data.value)
  const upstreams = computed(() => catalog.value.services.map(
    service => service.upstream
  ))
  const driftedServices = computed(() => catalog.value.services.filter(
    service => service.targetDrift.length > 0
  ))
  const allDrift = computed(() => catalog.value.services.flatMap(
    service => service.targetDrift
  ))
  // Address changes require discovery and do not count as applicable changes.
  // Other pending changes can still publish using the last verified Targets.
  const requiresDiscovery = computed(() => allDrift.value.some(
    item => item.kind === 'address_changed'
  ))
  const applyChangeCount = computed(() => (
    catalog.value.totals.pending
    + allDrift.value.filter(item => item.kind !== 'address_changed').length
  ))
  const canApply = computed(() => applyChangeCount.value > 0)
  const loading = catalogResource.loading
  const resourceError = catalogResource.error
  const focusedUpstreamId = computed(() => (
    typeof route.query.upstreamId === 'string' ? route.query.upstreamId : ''
  ))
  const statusItems = computed(() => [
    { label: t('admin.apis.routing.catalog.filters.all'), value: 'all' },
    { label: t('admin.apis.routing.catalog.filters.live'), value: 'live' },
    { label: t('admin.apis.routing.catalog.filters.available'), value: 'available' },
    { label: t('admin.apis.routing.catalog.filters.attention'), value: 'attention' },
    { label: t('admin.apis.routing.catalog.filters.disabled'), value: 'disabled' }
  ])
  const visibleServices = computed(() => {
    const keyword = search.value.trim().toLocaleLowerCase()
    return catalog.value.services
      .filter(service => (
        !focusedUpstreamId.value
        || service.upstream.id === focusedUpstreamId.value
      ))
      .map((service) => {
        const endpoints = service.endpoints.filter((item) => {
          const matchesStatus = statusFilter.value === 'all'
            || item.status === statusFilter.value
            || (statusFilter.value === 'attention'
              && (item.status === 'pending'
                || item.status === 'retiring'
                || item.sourceKind === 'missing'))
          if (!matchesStatus) return false
          if (!keyword) return true
          return [
            service.upstream.name,
            service.upstream.connection?.serviceName,
            item.endpoint?.method,
            item.endpoint?.path,
            item.endpoint?.summary,
            item.endpoint?.operationId,
            item.route?.route.name,
            item.route?.route.pathPattern,
            item.route?.route.upstreamPathTemplate
          ].some(value => value?.toLocaleLowerCase().includes(keyword))
        })
        return { ...service, endpoints }
      })
      .filter(service => (
        service.endpoints.length > 0
        || (!keyword && statusFilter.value === 'all')
      ))
  })
  const operations = useAdminEndpointCatalogOperations({
    catalog,
    visibleServices,
    canApply,
    refresh: () => catalogResource.refresh()
  })

  async function refresh() {
    if (operations.controls.value.refreshDisabled) return
    await catalogResource.refresh()
  }

  watch(routeModalOpen, (open) => {
    if (!open) {
      editingRoute.value = null
    }
  })

  function openEditRoute(item: PlatformEndpointCatalogItem) {
    if (operations.endpointState(item).editDisabled || !item.route) return
    editingRoute.value = item.route
    routeModalOpen.value = true
  }

  function clearFocusedService() {
    if (operations.controls.value.filtersDisabled) return
    const query = { ...route.query }
    delete query.upstreamId
    void router.replace({ query })
  }

  function resetFilters() {
    if (operations.controls.value.filtersDisabled) return
    search.value = ''
    statusFilter.value = 'all'
  }

  return {
    ...operations,
    applyChangeCount,
    canApply,
    catalog,
    clearFocusedService,
    driftedServices,
    editingRoute,
    focusedUpstreamId,
    loading,
    openEditRoute,
    refresh,
    requiresDiscovery,
    resetFilters,
    resourceError,
    routeModalOpen,
    search,
    statusFilter,
    statusItems,
    upstreams,
    visibleServices
  }
}
