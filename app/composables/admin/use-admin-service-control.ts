import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import { useOperationLifecycle } from '~/composables/use-operation-lifecycle'
import type { PlatformUpstreamDetail, ServiceConfigurationSyncOutcome, ServiceDiscoveryOutcome } from '#shared/types/service-control'
import { UPSTREAM_CONSTRAINTS } from '#shared/schemas/platform-constraints'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'
import { useAdminTargetOperations } from '~/composables/admin/use-admin-target-operations'
import type { ServiceConfigurationFormPayload } from '~/composables/admin/use-admin-service-configuration-form'
import { parseFetchError } from '~/utils/client-error'

interface ServiceFeedback {
  message: string
  description?: string
  color: 'success' | 'warning' | 'error'
}

const failureKeys = {
  discover: 'admin.apis.routing.serviceControl.discoveryFailed',
  token: 'admin.apis.routing.serviceControl.tokenUpdateFailed',
  save: 'admin.apis.routing.serviceControl.configurationSaveFailed',
  synchronize: 'admin.apis.routing.serviceControl.configurationSyncFailed'
} as const
type OperationKind = keyof typeof failureKeys

const synchronizationFeedback = {
  synced: { message: 'admin.apis.routing.serviceControl.configurationSynced', color: 'success' },
  partial: { message: 'admin.apis.routing.serviceControl.configurationPartial', color: 'warning' },
  failed: { message: 'admin.apis.routing.serviceControl.configurationFailed', color: 'error' }
} as const

export function useAdminServiceControl(upstreamId: Readonly<Ref<string>>) {
  const { t } = useI18n()
  const resource = usePrivateResource<PlatformUpstreamDetail | null>({
    path: () => `/api/admin/v1/upstreams/${upstreamId.value}/service`,
    defaultData: () => null
  })
  const view = computed(() => resource.data.value?.connection.upstreamServiceId === upstreamId.value
    ? resource.data.value : null)
  const managementUpstream = computed(() => view.value?.upstream ?? null)
  const loading = computed(() => resource.loading.value)
  const refreshError = shallowRef<unknown>(null)
  const loadError = computed(() => resource.error.value || refreshError.value)
  const serviceToken = ref('')
  const pageFeedback = ref<ServiceFeedback | null>(null)
  const configurationFeedback = ref<ServiceFeedback | null>(null)
  const tokenFeedback = ref<ServiceFeedback | null>(null)
  const lifecycle = useOperationLifecycle({ context: upstreamId, onInvalidate: clearContext })
  const { active, disposed } = lifecycle

  const targetOperations = useAdminTargetOperations({
    context: () => upstreamId.value,
    refresh: () => refreshData(),
    isBlocked: () => disposed.value || !upstreamId.value || active.value !== null || loading.value
  })
  const operationBusy = computed(() => active.value !== null || targetOperations.state.value.busy)
  const disabled = computed(() => disposed.value || !upstreamId.value || operationBusy.value || loading.value)
  const controls = computed(() => ({
    discovering: active.value === 'discover',
    updatingToken: active.value === 'token',
    saving: active.value === 'save',
    synchronizing: active.value === 'synchronize',
    discoverDisabled: disabled.value,
    tokenInputDisabled: disabled.value,
    tokenUpdateDisabled: disabled.value || !serviceToken.value.trim(),
    configurationDisabled: disabled.value || !view.value?.connection.discovered || !view.value.definition?.groups.length,
    synchronizationDisabled: disabled.value || !view.value?.connection.discovered || view.value.connection.configurationRevision < 1,
    refreshDisabled: disposed.value || !upstreamId.value || operationBusy.value
  }))

  function clearContext() {
    serviceToken.value = ''
    pageFeedback.value = null
    configurationFeedback.value = null
    tokenFeedback.value = null
    refreshError.value = null
  }

  watch(upstreamId, (id) => {
    resource.data.value = null
    resource.error.value = null
    if (id) void refreshData()
  }, { flush: 'sync' })

  async function refreshData() {
    if (disposed.value || !upstreamId.value) return
    const effects = lifecycle.capture()
    refreshError.value = null
    await effects.execute({
      request: async () => {
        const result = await resource.refresh()
        if (result?.status === 'error') throw result.error
      },
      reject: (error) => { refreshError.value = error }
    }).catch(() => false)
  }

  async function refresh() {
    if (controls.value.refreshDisabled) return
    await refreshData()
  }

  async function runOperation<T>(operation: {
    kind: OperationKind
    feedback: Ref<ServiceFeedback | null>
    request: (id: string) => Promise<T>
    accept: (result: T) => void
    refreshAfterFailure?: boolean
  }): Promise<boolean> {
    if (disabled.value) return false
    const id = upstreamId.value
    operation.feedback.value = null
    return lifecycle.run(operation.kind, scope => scope.execute({
      request: () => operation.request(id),
      accept: async (result) => {
        operation.accept(result)
        await refreshData()
      },
      reject: async (error) => {
        operation.feedback.value = { message: parseFetchError(error, t(failureKeys[operation.kind])), color: 'error' }
        if (operation.refreshAfterFailure) await refreshData()
      }
    })).catch(() => false)
  }

  function discover() {
    return runOperation({
      kind: 'discover',
      feedback: pageFeedback,
      request: id => $fetch<ServiceDiscoveryOutcome>(`/api/admin/v1/upstreams/${id}/discover`, { method: 'POST' }),
      accept: (result) => {
        if (resource.data.value) {
          resource.data.value = { ...result, upstream: { ...resource.data.value.upstream, connection: result.connection } }
        }
        pageFeedback.value = result.routingStatus === 'pending' ? {
          message: t('admin.apis.routing.serviceControl.discoveryRoutingPending'),
          description: t('admin.apis.routing.serviceControl.discoveryRoutingRetry'),
          color: 'warning'
        } : {
          message: result.connection.lastDiscoveryError
            ? t('admin.apis.routing.serviceControl.discoveryPartial')
            : t('admin.apis.routing.serviceControl.discoverySucceeded'),
          color: result.connection.lastDiscoveryError ? 'warning' : 'success'
        }
      },
      refreshAfterFailure: true
    })
  }

  async function updateServiceToken() {
    if (disabled.value) return false
    const token = serviceToken.value.trim()
    if (token.length < UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MIN_LENGTH
      || token.length > UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MAX_LENGTH) {
      tokenFeedback.value = { message: t('admin.apis.routing.validation.serviceTokenInvalid'), color: 'error' }
      return false
    }
    return runOperation({
      kind: 'token',
      feedback: tokenFeedback,
      request: id => $fetch(`/api/admin/v1/upstreams/${id}/token`, { method: 'PUT', body: { serviceToken: token } }),
      accept: () => {
        if (serviceToken.value.trim() === token) serviceToken.value = ''
        tokenFeedback.value = {
          message: t('admin.apis.routing.serviceControl.tokenUpdated'),
          description: t('admin.apis.routing.serviceControl.rediscoverAfterToken'),
          color: 'success'
        }
      },
    })
  }

  function configurationResult(result: ServiceConfigurationSyncOutcome, includeRevision = false): ServiceFeedback {
    if (result.routingStatus === 'pending') return {
      message: t('admin.apis.routing.serviceControl.configurationRoutingPending'),
      description: t('admin.apis.routing.serviceControl.configurationRoutingRetry'),
      color: 'warning'
    }
    const feedback = synchronizationFeedback[result.status]
    return {
      message: t(feedback.message),
      color: feedback.color,
      ...(includeRevision ? {
        description: t('admin.apis.routing.serviceControl.configurationRevision', { revision: result.revision })
      } : {})
    }
  }

  function acceptConfiguration(result: ServiceConfigurationSyncOutcome) {
    const current = resource.data.value
    if (!current) return
    const connection = { ...current.connection,
      configurationRevision: result.revision, configurationHash: result.configurationHash }
    resource.data.value = { ...current, connection, values: result.values, targets: result.targets,
      upstream: { ...current.upstream, connection } }
  }

  async function saveConfiguration(payload: ServiceConfigurationFormPayload) {
    if (controls.value.configurationDisabled) return false
    return runOperation({
      kind: 'save',
      feedback: configurationFeedback,
      request: id => $fetch<ServiceConfigurationSyncOutcome>(`/api/admin/v1/upstreams/${id}/configuration`, { method: 'PUT', body: payload }),
      accept: (result) => {
        acceptConfiguration(result)
        configurationFeedback.value = configurationResult(result, true)
      },
      refreshAfterFailure: true,
    })
  }

  async function synchronizeConfiguration() {
    if (controls.value.synchronizationDisabled) return false
    return runOperation({
      kind: 'synchronize',
      feedback: pageFeedback,
      request: id => $fetch<ServiceConfigurationSyncOutcome>(`/api/admin/v1/upstreams/${id}/configuration/sync`, { method: 'POST' }),
      accept: (result) => {
        acceptConfiguration(result)
        pageFeedback.value = configurationResult(result)
      },
      refreshAfterFailure: true,
    })
  }

  return {
    view,
    managementUpstream,
    loading,
    loadError,
    controls,
    serviceToken,
    pageFeedback: computed(() => pageFeedback.value),
    configurationFeedback: computed(() => configurationFeedback.value),
    tokenFeedback: computed(() => tokenFeedback.value),
    targetOperations,
    refresh,
    discover,
    updateServiceToken,
    saveConfiguration,
    synchronizeConfiguration
  }
}
