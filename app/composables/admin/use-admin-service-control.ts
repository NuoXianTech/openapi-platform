import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import type { PlatformUpstream } from '#shared/types/platform'
import type { ServiceConfigurationSyncOutcome, ServiceConfigurationView } from '#shared/types/service-control'
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
type RefreshScope = 'service' | 'upstreams' | 'both'

const synchronizationFeedback = {
  synced: { message: 'admin.apis.routing.serviceControl.configurationSynced', color: 'success' },
  partial: { message: 'admin.apis.routing.serviceControl.configurationPartial', color: 'warning' },
  failed: { message: 'admin.apis.routing.serviceControl.configurationFailed', color: 'error' }
} as const

export function useAdminServiceControl(upstreamId: Readonly<Ref<string>>) {
  const { t } = useI18n()
  const resource = usePrivateResource<ServiceConfigurationView | null>({
    path: () => `/api/admin/v1/upstreams/${upstreamId.value}/service`,
    defaultData: () => null
  })
  const upstreamResource = usePrivateResource<PlatformUpstream[]>({
    path: '/api/admin/v1/upstreams',
    defaultData: () => []
  })
  const view = computed(() => resource.data.value?.connection.upstreamServiceId === upstreamId.value
    ? resource.data.value : null)
  const managementUpstream = computed(() => upstreamResource.data.value.find(upstream => upstream.id === upstreamId.value) ?? null)
  const loading = computed(() => resource.loading.value || upstreamResource.loading.value)
  const refreshError = shallowRef<unknown>(null)
  const loadError = computed(() => resource.error.value || upstreamResource.error.value || refreshError.value)
  const serviceToken = ref('')
  const pageFeedback = ref<ServiceFeedback | null>(null)
  const configurationFeedback = ref<ServiceFeedback | null>(null)
  const tokenFeedback = ref<ServiceFeedback | null>(null)
  const active = shallowRef<{ kind: OperationKind, upstreamId: string, generation: number } | null>(null)
  let generation = 0
  const disposed = ref(false)

  const targetOperations = useAdminTargetOperations({
    context: () => upstreamId.value,
    refresh: () => refreshData('both'),
    isBlocked: () => disposed.value || !upstreamId.value || active.value !== null || loading.value
  })
  const operationBusy = computed(() => active.value !== null || targetOperations.state.value.busy)
  const disabled = computed(() => disposed.value || !upstreamId.value || operationBusy.value || loading.value)
  const controls = computed(() => ({
    discovering: active.value?.kind === 'discover',
    updatingToken: active.value?.kind === 'token',
    saving: active.value?.kind === 'save',
    synchronizing: active.value?.kind === 'synchronize',
    discoverDisabled: disabled.value,
    tokenInputDisabled: disabled.value,
    tokenUpdateDisabled: disabled.value || !serviceToken.value.trim(),
    configurationDisabled: disabled.value || !view.value?.connection.discovered || !view.value.definition?.groups.length,
    synchronizationDisabled: disabled.value || !view.value?.connection.discovered || view.value.connection.configurationRevision < 1,
    refreshDisabled: disposed.value || !upstreamId.value || operationBusy.value
  }))

  function clearContext() {
    generation += 1
    active.value = null
    serviceToken.value = ''
    pageFeedback.value = null
    configurationFeedback.value = null
    tokenFeedback.value = null
    refreshError.value = null
  }

  watch(upstreamId, (id) => {
    clearContext()
    resource.data.value = null
    resource.error.value = null
    upstreamResource.error.value = null
    if (id) void refreshData('both')
  }, { flush: 'sync' })

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed.value = true
      clearContext()
    })
  }

  async function refreshData(scope: RefreshScope) {
    if (disposed.value || !upstreamId.value) return
    const startedGeneration = generation
    refreshError.value = null
    try {
      const results = await Promise.all([
        ...(scope !== 'upstreams' ? [resource.refresh()] : []),
        ...(scope !== 'service' ? [upstreamResource.refresh()] : [])
      ])
      const failure = results.find(result => result?.status === 'error')
      if (failure?.status === 'error') throw failure.error
    } catch (error: unknown) {
      // A completed mutation stays completed even if the subsequent read fails.
      if (!disposed.value && startedGeneration === generation) refreshError.value = error
    }
  }

  async function refresh() {
    if (controls.value.refreshDisabled) return
    await refreshData('both')
  }

  async function runOperation<T>(operation: {
    kind: OperationKind
    feedback: Ref<ServiceFeedback | null>
    request: (id: string) => Promise<T>
    accept: (result: T) => void
    refresh: RefreshScope
    refreshAfterFailure?: boolean
  }): Promise<boolean> {
    if (disabled.value) return false
    const started = { kind: operation.kind, upstreamId: upstreamId.value, generation }
    const isCurrent = () => !disposed.value && started.generation === generation
    active.value = started
    operation.feedback.value = null
    try {
      const result = await operation.request(started.upstreamId)
      if (!isCurrent()) return false
      operation.accept(result)
      await refreshData(operation.refresh)
      return isCurrent()
    } catch (error: unknown) {
      if (!isCurrent()) return false
      operation.feedback.value = { message: parseFetchError(error, t(failureKeys[operation.kind])), color: 'error' }
      if (operation.refreshAfterFailure) await refreshData('service')
      return false
    } finally {
      // An older request cannot release an operation started in a new context.
      if (active.value === started) active.value = null
    }
  }

  function discover() {
    return runOperation({
      kind: 'discover',
      feedback: pageFeedback,
      request: id => $fetch<ServiceConfigurationView>(`/api/admin/v1/upstreams/${id}/discover`, { method: 'POST' }),
      accept: (result) => {
        resource.data.value = result
        pageFeedback.value = {
          message: result.connection.lastDiscoveryError
            ? t('admin.apis.routing.serviceControl.discoveryPartial')
            : t('admin.apis.routing.serviceControl.discoverySucceeded'),
          color: result.connection.lastDiscoveryError ? 'warning' : 'success'
        }
      },
      refresh: 'upstreams',
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
      refresh: 'service'
    })
  }

  function configurationResult(result: ServiceConfigurationSyncOutcome, includeRevision = false): ServiceFeedback {
    const feedback = synchronizationFeedback[result.status]
    return {
      message: t(feedback.message),
      color: feedback.color,
      ...(includeRevision ? {
        description: t('admin.apis.routing.serviceControl.configurationRevision', { revision: result.revision })
      } : {})
    }
  }

  async function saveConfiguration(payload: ServiceConfigurationFormPayload) {
    if (controls.value.configurationDisabled) return false
    return runOperation({
      kind: 'save',
      feedback: configurationFeedback,
      request: id => $fetch<ServiceConfigurationSyncOutcome>(`/api/admin/v1/upstreams/${id}/configuration`, { method: 'PUT', body: payload }),
      accept: (result) => { configurationFeedback.value = configurationResult(result, true) },
      refresh: 'service'
    })
  }

  async function synchronizeConfiguration() {
    if (controls.value.synchronizationDisabled) return false
    return runOperation({
      kind: 'synchronize',
      feedback: pageFeedback,
      request: id => $fetch<ServiceConfigurationSyncOutcome>(`/api/admin/v1/upstreams/${id}/configuration/sync`, { method: 'POST' }),
      accept: (result) => { pageFeedback.value = configurationResult(result) },
      refresh: 'service'
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
