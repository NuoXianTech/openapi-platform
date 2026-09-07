import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import type {
  PlatformEndpointCatalog,
  PlatformEndpointCatalogItem,
  PlatformEndpointCatalogService,
  PlatformEndpointPublicationPatch,
  PlatformEndpointPublicationResult,
  PlatformRouteBinding
} from '#shared/types/platform'
import { parseFetchError } from '~/utils/client-error'
import type { ServiceConfigurationView } from '#shared/types/service-control'

export interface EndpointFeedback {
  message: string
  description?: string
  color: 'success' | 'warning' | 'error'
}

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
  const confirm = useConfirmDialog()
  const catalogResource = usePrivateResource<PlatformEndpointCatalog>({
    path: '/api/admin/v1/service-endpoints',
    defaultData: emptyCatalog
  })
  const search = ref('')
  const statusFilter = ref('all')
  const busyKeys = ref(new Set<string>())
  const endpointFeedback = ref<Record<string, EndpointFeedback>>({})
  const catalogFeedback = ref<EndpointFeedback | null>(null)
  const selectedKeys = ref(new Set<string>())
  const bulkFeedback = ref<EndpointFeedback | null>(null)
  const bulkProgress = ref({ completed: 0, total: 0 })
  const operationBusy = computed(() => busyKeys.value.size > 0)
  const routeModalOpen = ref(false)
  const editingRoute = ref<PlatformRouteBinding | null>(null)

  const catalog = computed(() => catalogResource.data.value)
  const upstreams = computed(() => catalog.value.services.map(
    service => service.upstream
  ))
  const serviceUpstreams = computed(() => upstreams.value.filter(
    upstream => upstream.status === 'active'
  ))
  const driftedServices = computed(() => catalog.value.services.filter(
    service => service.targetDrift.length > 0
  ))
  const allDrift = computed(() => catalog.value.services.flatMap(
    service => service.targetDrift
  ))
  // Publication only adopts Targets discovery already verified, and an
  // `address_changed` Target is unverified by definition: publishing it
  // reproduces the same payload and leaves the active revision untouched. So it
  // must not enable Apply, and it needs discovery instead.
  const requiresDiscovery = computed(() => allDrift.value.some(
    item => item.kind === 'address_changed'
  ))
  const applyChangeCount = computed(() => (
    catalog.value.totals.pending
    + allDrift.value.filter(item => item.kind !== 'address_changed').length
  ))
  const canApply = computed(() => (
    !requiresDiscovery.value
    && applyChangeCount.value > 0
  ))
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
  const selectableEndpoints = computed(() => visibleServices.value.flatMap(service => (
    service.endpoints
      .filter(item => item.publishable && item.status !== 'pending' && item.status !== 'retiring')
      .map(item => ({ service, item }))
  )))
  const selectableKeys = computed(() => new Set(selectableEndpoints.value.map(({ item }) => item.key)))
  const selectedEndpoints = computed(() => selectableEndpoints.value.filter(({ item }) => selectedKeys.value.has(item.key)))
  const selectedEnableCount = computed(() => selectedEndpoints.value.filter(({ item }) => item.status !== 'live').length)
  const selectedDisableCount = computed(() => selectedEndpoints.value.filter(({ item }) => item.status === 'live' && item.route).length)
  const selectionState = computed(() => selectedEndpoints.value.length === 0
    ? false
    : selectedEndpoints.value.length === selectableEndpoints.value.length ? true : 'indeterminate' as const)

  watch(selectableKeys, (keys) => {
    selectedKeys.value = new Set([...selectedKeys.value].filter(key => keys.has(key)))
  })

  function selectEndpoints(keys: string[], selected: boolean) {
    if (operationBusy.value) return
    const next = new Set(selectedKeys.value)
    for (const key of keys) {
      if (selected && selectableKeys.value.has(key)) next.add(key)
      else next.delete(key)
    }
    selectedKeys.value = next
    bulkFeedback.value = null
  }

  function selectAllEndpoints(selected: boolean) {
    selectEndpoints([...selectableKeys.value], selected)
  }

  watch(routeModalOpen, (open) => {
    if (!open) {
      editingRoute.value = null
    }
  })

  function setBusy(key: string, value: boolean) {
    const next = new Set(busyKeys.value)
    if (value) next.add(key)
    else next.delete(key)
    busyKeys.value = next
  }

  function isBusy(key: string) {
    return busyKeys.value.has(key)
  }

  function showPublicationResult(
    item: PlatformEndpointCatalogItem,
    result: PlatformEndpointPublicationResult,
    successKey: string
  ) {
    const runtimeUpdated = Boolean(result.revision)
    if (runtimeUpdated) {
      for (const feedback of Object.values(endpointFeedback.value)) {
        if (feedback.color !== 'warning') continue
        feedback.message = t('admin.apis.routing.catalog.feedback.changesApplied')
        feedback.color = 'success'
      }
    }
    const feedback: EndpointFeedback = {
      message: t(runtimeUpdated
        ? successKey
        : 'admin.apis.routing.catalog.feedback.savedPending'),
      color: runtimeUpdated ? 'success' : 'warning'
    }
    endpointFeedback.value[item.route?.route.id ?? item.key] = feedback
    // Discovery gives a newly published endpoint a new catalog key.
    if (!item.route) endpointFeedback.value[result.route.id] = feedback
  }

  async function refresh() {
    await catalogResource.refresh()
  }

  async function discoverService(upstreamId: string, quiet = false) {
    const key = `discover:${upstreamId}`
    if (!quiet) catalogFeedback.value = null
    setBusy(key, true)
    try {
      const result = await $fetch<ServiceConfigurationView>(
        `/api/admin/v1/upstreams/${upstreamId}/discover`,
        { method: 'POST' }
      )
      if (!quiet) {
        catalogFeedback.value = {
          message: result.connection.lastDiscoveryError
            ? t('admin.apis.routing.serviceControl.discoveryPartial')
            : t('admin.apis.routing.catalog.feedback.serviceDiscovered'),
          color: result.connection.lastDiscoveryError ? 'warning' : 'success'
        }
        await refresh()
      }
      return result.connection.lastDiscoveryError ? 'partial' as const : true
    } catch (error: unknown) {
      if (!quiet) {
        catalogFeedback.value = {
          message: parseFetchError(
            error,
            t('admin.apis.routing.serviceControl.discoveryFailed')
          ),
          color: 'error'
        }
        await refresh()
      }
      return false
    } finally {
      setBusy(key, false)
    }
  }

  async function discoverAllServices() {
    if (serviceUpstreams.value.length === 0) return
    catalogFeedback.value = null
    const key = 'discover:all'
    setBusy(key, true)
    try {
      const results: Array<boolean | 'partial'> = []
      const queue = [...serviceUpstreams.value]
      const worker = async () => {
        while (queue.length > 0) {
          const upstream = queue.shift()
          if (!upstream) return
          results.push(await discoverService(upstream.id, true))
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
      await refresh()
      const succeeded = results.filter(Boolean).length
      const partial = results.filter(result => result === 'partial').length
      const failed = results.filter(result => result === false).length
      catalogFeedback.value = {
        message: t('admin.apis.routing.catalog.feedback.discoveryCompleted', {
          succeeded: succeeded - partial,
          partial,
          failed
        }),
        color: failed > 0 ? 'error' : partial > 0 ? 'warning' : 'success'
      }
    } finally {
      setBusy(key, false)
    }
  }

  /**
   * Publication covers the whole runtime, so one unready Upstream blocks
   * every other pending change. Name it instead of leaving the admin to guess.
   */
  function blockingUpstreamName(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null
    const data = (error as { data?: { data?: { upstreamServiceId?: unknown } } })
      .data?.data
    const upstreamServiceId = typeof data?.upstreamServiceId === 'string'
      ? data.upstreamServiceId
      : null
    if (!upstreamServiceId) return null
    return upstreams.value.find(
      upstream => upstream.id === upstreamServiceId
    )?.name ?? upstreamServiceId
  }

  async function applyChanges() {
    if (!canApply.value || operationBusy.value) return
    const previousRevisionId = catalog.value.activeRevisionId
    catalogFeedback.value = null
    setBusy('apply:runtime', true)
    try {
      // Publication is idempotent: an unchanged payload returns the active
      // revision, so only a new id means the runtime actually moved.
      const result = await $fetch<{ revision: { id: string } }>(
        '/api/admin/v1/service-endpoints/apply',
        { method: 'POST' }
      )
      const runtimeUpdated = result.revision.id !== previousRevisionId
      if (runtimeUpdated) {
        endpointFeedback.value = {}
        bulkFeedback.value = null
      }
      catalogFeedback.value = {
        message: t('admin.apis.routing.catalog.feedback.changesApplied'),
        description: t(runtimeUpdated
          ? 'admin.apis.routing.feedback.runtimeUpdated'
          : 'admin.apis.routing.catalog.feedback.runtimeUnchanged'),
        color: runtimeUpdated ? 'success' : 'warning'
      }
      await refresh()
    } catch (error: unknown) {
      const blockedBy = blockingUpstreamName(error)
      catalogFeedback.value = {
        message: parseFetchError(
          error,
          t('admin.apis.routing.catalog.feedback.applyFailed')
        ),
        description: blockedBy
          ? t('admin.apis.routing.catalog.feedback.applyBlockedBy', {
              upstream: blockedBy
            })
          : undefined,
        color: 'error'
      }
      await catalogResource.refresh()
    } finally {
      setBusy('apply:runtime', false)
    }
  }

  async function publishEndpoint(
    service: PlatformEndpointCatalogService,
    item: PlatformEndpointCatalogItem,
    refreshAfter = true
  ): Promise<boolean> {
    if (!item.endpoint) return false
    const key = `endpoint:${item.key}`
    if (isBusy(key) || isBusy('apply:runtime')) return false
    catalogFeedback.value = null
    setBusy(key, true)
    Reflect.deleteProperty(endpointFeedback.value, item.key)
    try {
      const result = await $fetch<PlatformEndpointPublicationResult>(
        '/api/admin/v1/service-endpoints/publish',
        {
          method: 'POST',
          body: {
            upstreamServiceId: service.upstream.id,
            method: item.endpoint.method,
            path: item.endpoint.path
          }
        }
      )
      showPublicationResult(item, result, 'admin.apis.routing.catalog.feedback.published')
      if (refreshAfter) await refresh()
      return true
    } catch (error: unknown) {
      endpointFeedback.value[item.key] = {
        message: parseFetchError(
          error,
          t('admin.apis.routing.catalog.feedback.publishFailed')
        ),
        color: 'error'
      }
      if (refreshAfter) await catalogResource.refresh()
      return false
    } finally {
      setBusy(key, false)
    }
  }

  async function updatePublication(
    item: PlatformEndpointCatalogItem,
    patch: PlatformEndpointPublicationPatch,
    successKey: string,
    refreshAfter = true
  ): Promise<boolean> {
    const routeId = item.route?.route.id
    if (!routeId) return false
    const key = `endpoint:${item.key}`
    if (isBusy(key) || isBusy('apply:runtime')) return false
    catalogFeedback.value = null
    setBusy(key, true)
    Reflect.deleteProperty(endpointFeedback.value, routeId)
    try {
      const result = await $fetch<PlatformEndpointPublicationResult>(
        `/api/admin/v1/service-endpoints/${routeId}`,
        { method: 'PATCH', body: patch }
      )
      showPublicationResult(item, result, successKey)
      if (refreshAfter) await refresh()
      return true
    } catch (error: unknown) {
      endpointFeedback.value[routeId] = {
        message: parseFetchError(
          error,
          t('admin.apis.routing.catalog.feedback.updateFailed')
        ),
        color: 'error'
      }
      if (refreshAfter) await catalogResource.refresh()
      return false
    } finally {
      setBusy(key, false)
    }
  }

  async function handlePrimaryAction(
    service: PlatformEndpointCatalogService,
    item: PlatformEndpointCatalogItem
  ) {
    if (isBusy('bulk:endpoints')) return
    if (!item.route) {
      await publishEndpoint(service, item)
      return
    }
    if (item.status === 'pending' || item.status === 'retiring') {
      return
    }
    const enabled = item.status !== 'live'
    const update = () => updatePublication(
      item,
      { enabled },
      enabled
        ? 'admin.apis.routing.catalog.feedback.published'
        : 'admin.apis.routing.catalog.feedback.unpublished'
    )
    if (enabled) {
      await update()
      return
    }
    const confirmed = await confirm({
      title: t('admin.apis.routing.toggleRoute.title'),
      description: t('admin.apis.routing.toggleRoute.description'),
      confirmLabel: t('common.actions.disable'),
      confirmColor: 'warning'
    })
    if (confirmed) await update()
  }

  async function bulkSetEnabled(enabled: boolean) {
    if (operationBusy.value) return
    const candidates = selectedEndpoints.value.filter(({ item }) => (
      enabled ? item.status !== 'live' : item.status === 'live' && item.route
    ))
    if (candidates.length === 0) return
    setBusy('bulk:endpoints', true)
    bulkFeedback.value = null
    bulkProgress.value = { completed: 0, total: candidates.length }
    try {
      if (!enabled && !await confirm({
        title: t('admin.apis.routing.catalog.bulk.disableTitle', { count: candidates.length }),
        description: t('admin.apis.routing.toggleRoute.description'),
        confirmLabel: t('admin.apis.routing.catalog.bulk.disable'),
        confirmColor: 'warning'
      })) return

      let succeeded = 0
      let pending = 0
      // Publication changes share a runtime lock, so apply them in order.
      for (const { service, item } of candidates) {
        const success = item.route
          ? await updatePublication(item, { enabled }, enabled
            ? 'admin.apis.routing.catalog.feedback.published'
            : 'admin.apis.routing.catalog.feedback.unpublished', false)
          : await publishEndpoint(service, item, false)
        if (success) {
          succeeded += 1
          if (endpointFeedback.value[item.route?.route.id ?? item.key]?.color === 'warning') pending += 1
          else pending = 0
          selectedKeys.value.delete(item.key)
        }
        bulkProgress.value.completed += 1
      }
      bulkFeedback.value = {
        message: t('admin.apis.routing.catalog.bulk.completed', {
          succeeded,
          failed: candidates.length - succeeded,
          pending
        }),
        color: succeeded < candidates.length ? 'error' : pending > 0 ? 'warning' : 'success'
      }
      await refresh()
    } finally {
      setBusy('bulk:endpoints', false)
    }
  }

  function openEditRoute(item: PlatformEndpointCatalogItem) {
    if (!item.route) return
    editingRoute.value = item.route
    routeModalOpen.value = true
  }

  async function handleSettingsSaved(result: PlatformEndpointPublicationResult) {
    catalogFeedback.value = null
    const item = catalog.value.services.flatMap(service => service.endpoints)
      .find(item => item.route?.route.id === result.route.id)
    if (item) showPublicationResult(item, result, 'admin.apis.routing.feedback.routeUpdated')
    await refresh()
  }

  function clearFocusedService() {
    const query = { ...route.query }
    delete query.upstreamId
    void router.replace({ query })
  }

  function resetFilters() {
    search.value = ''
    statusFilter.value = 'all'
  }

  return {
    applyChanges,
    applyChangeCount,
    bulkFeedback,
    bulkProgress,
    bulkSetEnabled,
    canApply,
    catalog,
    catalogFeedback,
    clearFocusedService,
    discoverAllServices,
    discoverService,
    driftedServices,
    editingRoute,
    endpointFeedback,
    focusedUpstreamId,
    handlePrimaryAction,
    handleSettingsSaved,
    serviceUpstreams,
    isBusy,
    operationBusy,
    loading,
    openEditRoute,
    refresh,
    requiresDiscovery,
    resetFilters,
    resourceError,
    routeModalOpen,
    search,
    selectableKeys,
    selectedKeys,
    selectedEnableCount,
    selectedDisableCount,
    selectionState,
    selectEndpoints,
    selectAllEndpoints,
    statusFilter,
    statusItems,
    updatePublication,
    upstreams,
    visibleServices
  }
}
