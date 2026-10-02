import { onScopeDispose, type Ref } from 'vue'
import type {
  PlatformEndpointCatalog,
  PlatformEndpointCatalogItem,
  PlatformEndpointCatalogService,
  PlatformEndpointPublicationPatch,
  PlatformEndpointPublicationResult
} from '#shared/types/platform'
import type { ServiceDiscoveryOutcome } from '#shared/types/service-control'
import { parseFetchError } from '~/utils/client-error'
import type { PrivateReadResult } from '~/composables/dashboard/use-private-resource'

interface EndpointFeedback {
  message: string
  description?: string
  color: 'success' | 'warning' | 'error'
}

export interface EndpointOperationState {
  loading: boolean
  primaryDisabled: boolean
  settingsDisabled: boolean
  editDisabled: boolean
  feedback: EndpointFeedback | undefined
}

export interface DiscoveryOperationState {
  loading: boolean
  disabled: boolean
}

type PublicationOutcome = 'applied' | 'pending' | 'failed'
type PublicationSuccessKey =
  | 'admin.apis.routing.catalog.feedback.published'
  | 'admin.apis.routing.catalog.feedback.unpublished'
  | 'admin.apis.routing.catalog.feedback.statisticsEnabled'
  | 'admin.apis.routing.catalog.feedback.statisticsDisabled'
  | 'admin.apis.routing.catalog.feedback.apiKeyEnabled'
  | 'admin.apis.routing.catalog.feedback.apiKeyDisabled'
  | 'admin.apis.routing.feedback.routeUpdated'
type PublicationFailureKey =
  | 'admin.apis.routing.catalog.feedback.publishFailed'
  | 'admin.apis.routing.catalog.feedback.updateFailed'

export function useAdminEndpointCatalogOperations(options: {
  catalog: Readonly<Ref<PlatformEndpointCatalog>>
  visibleServices: Readonly<Ref<PlatformEndpointCatalogService[]>>
  canApply: Readonly<Ref<boolean>>
  refresh: () => Promise<PrivateReadResult>
}) {
  const { catalog, visibleServices, canApply, refresh: readCatalog } = options
  const { t } = useI18n()
  const confirm = useConfirmDialog()
  const disposed = ref(false)
  onScopeDispose(() => { disposed.value = true })
  const applying = ref(false)
  const discoveringAll = ref(false)
  const discoveringServices = ref(new Set<string>())
  const runningEndpoints = ref(new Set<string>())
  const bulkRunning = ref(false)
  // A newly published endpoint gains a route identity after catalog refresh.
  // Keep its operation and feedback identity stable for both old and new rows.
  const routeIdentities = ref(new Map<string, string>())
  const endpointResults = ref(new Map<string, { pending: boolean, feedback: EndpointFeedback }>())
  const catalogFeedback = ref<EndpointFeedback | null>(null)
  const bulkFeedback = ref<EndpointFeedback | null>(null)
  const bulkProgress = ref({ completed: 0, total: 0 })
  const selectedKeys = ref(new Set<string>())
  const busy = computed(() => disposed.value || applying.value || discoveringAll.value || bulkRunning.value
    || discoveringServices.value.size > 0 || runningEndpoints.value.size > 0)
  const serviceUpstreams = computed(() => catalog.value.services
    .map(service => service.upstream).filter(upstream => upstream.status === 'active'))

  function selectable(item: PlatformEndpointCatalogItem) {
    return item.publishable && item.status !== 'pending' && item.status !== 'retiring'
  }

  const selectableEndpoints = computed(() => visibleServices.value.flatMap(service => service.endpoints
    .filter(selectable).map(item => ({ service, item }))))
  const selectableKeys = computed(() => new Set(selectableEndpoints.value.map(({ item }) => item.key)))
  const selectedEndpoints = computed(() => selectableEndpoints.value.filter(({ item }) => selectedKeys.value.has(item.key)))
  const selectedEnableCount = computed(() => selectedEndpoints.value.filter(({ item }) => item.status !== 'live').length)
  const selectedDisableCount = computed(() => selectedEndpoints.value.filter(({ item }) => item.status === 'live' && item.route).length)
  const selectionState = computed(() => selectedEndpoints.value.length === 0
    ? false
    : selectedEndpoints.value.length === selectableEndpoints.value.length ? true : 'indeterminate' as const)

  const controls = computed(() => ({
    applying: applying.value,
    applyDisabled: !canApply.value || busy.value,
    discovering: discoveringAll.value,
    discoveryDisabled: serviceUpstreams.value.length === 0 || busy.value,
    bulkRunning: bulkRunning.value,
    bulkEnableDisabled: selectedEnableCount.value === 0 || busy.value,
    bulkDisableDisabled: selectedDisableCount.value === 0 || busy.value,
    selectionDisabled: busy.value,
    selectAllDisabled: selectableKeys.value.size === 0 || busy.value,
    clearSelectionDisabled: selectedKeys.value.size === 0 || busy.value,
    filtersDisabled: bulkRunning.value,
    refreshDisabled: busy.value
  }))

  watch(selectableKeys, (keys) => {
    selectedKeys.value = new Set([...selectedKeys.value].filter(key => keys.has(key)))
  })

  function selectEndpoints(keys: string[], selected: boolean) {
    if (controls.value.selectionDisabled) return
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

  function endpointIdentity(item: PlatformEndpointCatalogItem) {
    const routeId = item.route?.route.id
    return routeId ? routeIdentities.value.get(routeId) ?? `route:${routeId}` : `endpoint:${item.key}`
  }

  function endpointState(item: PlatformEndpointCatalogItem): EndpointOperationState {
    const identity = endpointIdentity(item)
    const loading = runningEndpoints.value.has(identity)
    // Discovery may overlap endpoint changes, as in the existing catalog UI.
    const blocked = disposed.value || loading || applying.value || bulkRunning.value
    return {
      loading,
      primaryDisabled: !selectable(item) || (!item.route && !item.endpoint) || blocked,
      settingsDisabled: !item.route || item.route.route.creditsCost > 0 || blocked,
      editDisabled: !item.route || blocked,
      feedback: endpointResults.value.get(identity)?.feedback
    }
  }

  function discoveryState(upstreamId: string): DiscoveryOperationState {
    return { loading: discoveringServices.value.has(upstreamId), disabled: busy.value }
  }

  function showPublicationResult(
    item: PlatformEndpointCatalogItem,
    result: PlatformEndpointPublicationResult,
    successKey: PublicationSuccessKey
  ): PublicationOutcome {
    const runtimeUpdated = Boolean(result.revision)
    const identity = endpointIdentity(item)
    if (!item.route) routeIdentities.value.set(result.route.id, identity)
    endpointResults.value.set(identity, {
      pending: !runtimeUpdated,
      feedback: {
        message: t(runtimeUpdated ? successKey : 'admin.apis.routing.catalog.feedback.savedPending'),
        color: runtimeUpdated ? 'success' : 'warning'
      }
    })
    return runtimeUpdated ? 'applied' : 'pending'
  }

  async function runDiscovery(upstreamId: string, quiet: boolean) {
    if (disposed.value) return false
    if (!quiet) catalogFeedback.value = null
    discoveringServices.value.add(upstreamId)
    try {
      const result = await $fetch<ServiceDiscoveryOutcome>(`/api/admin/v1/upstreams/${upstreamId}/discover`, { method: 'POST' })
      if (disposed.value) return false
      if (!quiet) {
        catalogFeedback.value = result.routingStatus === 'pending' ? {
          message: t('admin.apis.routing.serviceControl.discoveryRoutingPending'),
          description: t('admin.apis.routing.serviceControl.discoveryRoutingRetry'),
          color: 'warning'
        } : {
          message: result.connection.lastDiscoveryError
            ? t('admin.apis.routing.serviceControl.discoveryPartial')
            : t('admin.apis.routing.catalog.feedback.serviceDiscovered'),
          color: result.connection.lastDiscoveryError ? 'warning' : 'success'
        }
        await refreshAfterPublication()
      }
      return result.connection.lastDiscoveryError || result.routingStatus === 'pending' ? 'partial' as const : true
    } catch (error: unknown) {
      if (disposed.value) return false
      if (!quiet) {
        catalogFeedback.value = {
          message: parseFetchError(error, t('admin.apis.routing.serviceControl.discoveryFailed')),
          color: 'error'
        }
        await refreshAfterPublication()
      }
      return false
    } finally {
      discoveringServices.value.delete(upstreamId)
    }
  }

  async function discoverService(upstreamId: string) {
    if (discoveryState(upstreamId).disabled) return false
    return runDiscovery(upstreamId, false)
  }

  async function discoverAllServices() {
    if (controls.value.discoveryDisabled) return
    catalogFeedback.value = null
    discoveringAll.value = true
    try {
      const results: Array<boolean | 'partial'> = []
      const queue = [...serviceUpstreams.value]
      const worker = async () => {
        while (!disposed.value && queue.length > 0) {
          const upstream = queue.shift()
          if (!upstream) return
          results.push(await runDiscovery(upstream.id, true))
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
      if (disposed.value) return
      const partial = results.filter(result => result === 'partial').length
      const failed = results.filter(result => result === false).length
      catalogFeedback.value = {
        message: t('admin.apis.routing.catalog.feedback.discoveryCompleted', {
          succeeded: results.filter(result => result === true).length, partial, failed
        }),
        color: failed > 0 ? 'error' : partial > 0 ? 'warning' : 'success'
      }
      await refreshAfterPublication()
    } finally {
      discoveringAll.value = false
    }
  }

  function blockingUpstreamName(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null
    const data = (error as { data?: { data?: { upstreamServiceId?: unknown } } }).data?.data
    const upstreamServiceId = typeof data?.upstreamServiceId === 'string' ? data.upstreamServiceId : null
    if (!upstreamServiceId) return null
    return catalog.value.services.find(service => service.upstream.id === upstreamServiceId)?.upstream.name ?? upstreamServiceId
  }

  async function applyChanges() {
    if (controls.value.applyDisabled) return
    const previousRevisionId = catalog.value.activeRevisionId
    catalogFeedback.value = null
    applying.value = true
    try {
      const result = await $fetch<{ revision: { id: string } }>('/api/admin/v1/service-endpoints/apply', { method: 'POST' })
      if (disposed.value) return
      // An idempotent apply can return the existing revision without publishing.
      const runtimeUpdated = result.revision.id !== previousRevisionId
      if (runtimeUpdated) {
        endpointResults.value.clear()
        bulkFeedback.value = null
      }
      catalogFeedback.value = {
        message: t('admin.apis.routing.catalog.feedback.changesApplied'),
        description: t(runtimeUpdated ? 'admin.apis.routing.feedback.runtimeUpdated' : 'admin.apis.routing.catalog.feedback.runtimeUnchanged'),
        color: runtimeUpdated ? 'success' : 'warning'
      }
      await refreshAfterPublication()
    } catch (error: unknown) {
      if (disposed.value) return
      const blockedBy = blockingUpstreamName(error)
      catalogFeedback.value = {
        message: parseFetchError(error, t('admin.apis.routing.catalog.feedback.applyFailed')),
        description: blockedBy ? t('admin.apis.routing.catalog.feedback.applyBlockedBy', { upstream: blockedBy }) : undefined,
        color: 'error'
      }
      await refreshAfterPublication()
    } finally {
      applying.value = false
    }
  }

  // Only admitted public actions and the batch's own children enter here.
  // External callers cannot bypass admission with a quiet/refresh flag.
  async function runPublication(
    item: PlatformEndpointCatalogItem,
    mutate: () => Promise<PlatformEndpointPublicationResult>,
    successKey: PublicationSuccessKey,
    failureKey: PublicationFailureKey,
    refreshAfter: boolean
  ): Promise<PublicationOutcome> {
    // Admission is checked before dispatch, including the batch's own children.
    if (disposed.value) return 'failed'
    const identity = endpointIdentity(item)
    catalogFeedback.value = null
    runningEndpoints.value.add(identity)
    endpointResults.value.delete(identity)
    try {
      const result = await mutate()
      if (disposed.value) return 'failed'
      const outcome = showPublicationResult(item, result, successKey)
      if (refreshAfter) await refreshAfterPublication()
      return disposed.value ? 'failed' : outcome
    } catch (error: unknown) {
      if (disposed.value) return 'failed'
      endpointResults.value.set(identity, {
        pending: false,
        feedback: { message: parseFetchError(error, t(failureKey)), color: 'error' }
      })
      if (refreshAfter) await refreshAfterPublication()
      return 'failed'
    } finally {
      runningEndpoints.value.delete(identity)
    }
  }

  function updatePublication(
    item: PlatformEndpointCatalogItem,
    patch: PlatformEndpointPublicationPatch,
    successKey: PublicationSuccessKey,
    refreshAfter = true
  ) {
    const routeId = item.route?.route.id
    if (!routeId) return Promise.resolve<PublicationOutcome>('failed')
    return runPublication(item, () => $fetch<PlatformEndpointPublicationResult>(
      `/api/admin/v1/service-endpoints/${routeId}`, { method: 'PATCH', body: patch }
    ), successKey, 'admin.apis.routing.catalog.feedback.updateFailed', refreshAfter)
  }

  function setEndpointEnabled(
    service: PlatformEndpointCatalogService,
    item: PlatformEndpointCatalogItem,
    enabled: boolean,
    refreshAfter = true
  ) {
    if (item.route) {
      return updatePublication(item, { enabled }, enabled
        ? 'admin.apis.routing.catalog.feedback.published'
        : 'admin.apis.routing.catalog.feedback.unpublished', refreshAfter)
    }
    if (!item.endpoint) return Promise.resolve<PublicationOutcome>('failed')
    const endpoint = item.endpoint
    return runPublication(item, () => $fetch<PlatformEndpointPublicationResult>('/api/admin/v1/service-endpoints/publish', {
      method: 'POST',
      body: { upstreamServiceId: service.upstream.id, method: endpoint.method, path: endpoint.path }
    }), 'admin.apis.routing.catalog.feedback.published', 'admin.apis.routing.catalog.feedback.publishFailed', refreshAfter)
  }

  async function handlePrimaryAction(service: PlatformEndpointCatalogService, item: PlatformEndpointCatalogItem) {
    if (endpointState(item).primaryDisabled) return false
    const enabled = item.status !== 'live'
    if (!enabled && !await confirm({
      title: t('admin.apis.routing.toggleRoute.title'),
      description: t('admin.apis.routing.toggleRoute.description'),
      confirmLabel: t('common.actions.disable'),
      confirmColor: 'warning'
    })) return false
    // Another operation may have started while the confirmation was open.
    if (endpointState(item).primaryDisabled) return false
    return await setEndpointEnabled(service, item, enabled) !== 'failed'
  }

  async function toggleStatistics(item: PlatformEndpointCatalogItem) {
    if (endpointState(item).settingsDisabled || !item.route) return false
    const enabled = !item.route.route.isStatistics
    return await updatePublication(item, { isStatistics: enabled }, enabled
      ? 'admin.apis.routing.catalog.feedback.statisticsEnabled'
      : 'admin.apis.routing.catalog.feedback.statisticsDisabled') !== 'failed'
  }

  async function toggleApiKey(item: PlatformEndpointCatalogItem) {
    if (endpointState(item).settingsDisabled || !item.route) return false
    const enabled = !item.route.route.isApiKey
    return await updatePublication(item, { isApiKey: enabled }, enabled
      ? 'admin.apis.routing.catalog.feedback.apiKeyEnabled'
      : 'admin.apis.routing.catalog.feedback.apiKeyDisabled') !== 'failed'
  }

  async function bulkSetEnabled(enabled: boolean) {
    if (enabled ? controls.value.bulkEnableDisabled : controls.value.bulkDisableDisabled) return
    const candidates = selectedEndpoints.value.filter(({ item }) => enabled ? item.status !== 'live' : item.status === 'live' && item.route)
    bulkRunning.value = true
    bulkFeedback.value = null
    bulkProgress.value = { completed: 0, total: candidates.length }
    try {
      if (!enabled && !await confirm({
        title: t('admin.apis.routing.catalog.bulk.disableTitle', { count: candidates.length }),
        description: t('admin.apis.routing.toggleRoute.description'),
        confirmLabel: t('admin.apis.routing.catalog.bulk.disable'),
        confirmColor: 'warning'
      })) return

      if (disposed.value) return

      let succeeded = 0
      let pending = 0
      // Publication changes share a runtime lock, so execute batch children in order.
      for (const { service, item } of candidates) {
        if (disposed.value) return
        const outcome = await setEndpointEnabled(service, item, enabled, false)
        if (disposed.value) return
        if (outcome !== 'failed') {
          succeeded += 1
          if (outcome === 'pending') pending += 1
          selectedKeys.value.delete(item.key)
        }
        bulkProgress.value.completed += 1
      }
      bulkFeedback.value = {
        message: t('admin.apis.routing.catalog.bulk.completed', { succeeded, failed: candidates.length - succeeded, pending }),
        color: succeeded < candidates.length ? 'error' : pending > 0 ? 'warning' : 'success'
      }
      await refreshAfterPublication()
    } finally {
      bulkRunning.value = false
    }
  }

  async function refreshAfterPublication() {
    if (disposed.value) return
    try {
      const result = await readCatalog()
      if (result?.status === 'error') throw result.error
    } catch (error: unknown) {
      if (!disposed.value) catalogFeedback.value = { message: parseFetchError(error, t('common.feedback.loadFailed')), color: 'error' }
    }
  }

  function findRoute(routeId: string) {
    return catalog.value.services.flatMap(service => service.endpoints).find(item => item.route?.route.id === routeId)
  }

  function settingsState(routeId: string) {
    const item = findRoute(routeId)
    const state = item ? endpointState(item) : null
    return {
      loading: state?.loading ?? false,
      disabled: state?.editDisabled ?? true,
      error: state?.feedback?.color === 'error' ? state.feedback.message : null
    }
  }

  async function saveSettings(routeId: string, patch: PlatformEndpointPublicationPatch) {
    const item = findRoute(routeId)
    if (!item || endpointState(item).editDisabled) return false
    return await updatePublication(item, patch, 'admin.apis.routing.feedback.routeUpdated') !== 'failed'
  }

  return {
    controls,
    endpointState,
    discoveryState,
    catalogFeedback,
    bulkFeedback,
    bulkProgress,
    selectableKeys,
    selectedKeys,
    selectedEnableCount,
    selectedDisableCount,
    selectionState,
    selectEndpoints,
    selectAllEndpoints,
    applyChanges,
    discoverService,
    discoverAllServices,
    handlePrimaryAction,
    toggleStatistics,
    toggleApiKey,
    bulkSetEnabled,
    settingsState,
    saveSettings
  }
}
