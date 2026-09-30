<script setup lang="ts">
import type {
  AdminClientIpStatus,
  ClientIpResolutionReason,
  ClientIpSource
} from '#shared/types/client-ip'
import { parseTrustedProxyCidrs } from '#shared/utils/proxy-cidrs'
import type { AdminSettingsKey } from '~/composables/admin/use-admin-settings-page'
import { useAdminSettingsPage } from '~/composables/admin/use-admin-settings-page'

const { form, createSection, save } = useAdminSettingsPage()
const { t } = useI18n()

const inlineNoticeUi = {
  root: 'rounded-none bg-transparent p-0 ring-0',
  wrapper: 'gap-0.5',
  title: 'text-sm font-medium text-highlighted',
  description: 'text-sm leading-5 text-muted opacity-100',
  icon: 'mt-0.5 size-4'
} as const

useHead({ title: () => t('admin.system.network.pageTitle') })

const networkKeys = [
  'clientIpSource',
  'trustedProxyCidrs',
  'clientIpForwardedHops'
] as const satisfies readonly AdminSettingsKey[]

const networkSection = createSection(networkKeys)
const status = ref<AdminClientIpStatus | null>(null)
const statusLoading = ref(false)
const statusFailed = ref(false)

const sourceItems = computed(() => [
  {
    value: 'direct' as ClientIpSource,
    label: t('admin.system.network.source.options.direct.label'),
    description: t('admin.system.network.source.options.direct.description')
  },
  {
    value: 'cloudflare' as ClientIpSource,
    label: t('admin.system.network.source.options.cloudflare.label'),
    description: t('admin.system.network.source.options.cloudflare.description')
  },
  {
    value: 'x_forwarded_for' as ClientIpSource,
    label: t('admin.system.network.source.options.xForwardedFor.label'),
    description: t('admin.system.network.source.options.xForwardedFor.description')
  }
])

const environmentManaged = computed(() => status.value?.effective.managedBy === 'environment')

const activeSource = computed<ClientIpSource>({
  get: () => environmentManaged.value
    ? status.value?.effective.source ?? form.clientIpSource
    : form.clientIpSource,
  set: (value) => {
    if (!environmentManaged.value) form.clientIpSource = value
  }
})

const activeTrustedCidrs = computed<string>({
  get: () => environmentManaged.value
    ? status.value?.effective.trustedProxyCidrs.join('\n') ?? ''
    : form.trustedProxyCidrs,
  set: (value) => {
    if (!environmentManaged.value) form.trustedProxyCidrs = value
  }
})

const activeForwardedHops = computed<number>({
  get: () => environmentManaged.value
    ? status.value?.effective.forwardedHops ?? form.clientIpForwardedHops
    : form.clientIpForwardedHops,
  set: (value) => {
    if (!environmentManaged.value) form.clientIpForwardedHops = value
  }
})

const parsedCidrs = computed(() => parseTrustedProxyCidrs(activeTrustedCidrs.value))
const requiresTrustedProxy = computed(() => activeSource.value !== 'direct')
const trustedCidrsError = computed(() => {
  if (environmentManaged.value || !requiresTrustedProxy.value) return undefined
  if (parsedCidrs.value.invalidEntries.length > 0) {
    return t('admin.system.network.trusted.validation.invalid', {
      entries: parsedCidrs.value.invalidEntries.slice(0, 5).join(', ')
    })
  }
  if (parsedCidrs.value.cidrs.length === 0) {
    return t('admin.system.network.trusted.validation.required')
  }
  if (parsedCidrs.value.cidrs.length > 256) {
    return t('admin.system.network.trusted.validation.tooMany')
  }
  return undefined
})

const trustsEveryAddress = computed(() => (
  parsedCidrs.value.trustsAllIpv4 || parsedCidrs.value.trustsAllIpv6
))

const statusHeaderLabel = computed(() => {
  if (status.value?.effective.source === 'cloudflare') return 'CF-Connecting-IP'
  if (status.value?.effective.source === 'x_forwarded_for') return 'X-Forwarded-For'
  return t('admin.system.network.diagnostics.ignoredHeader')
})

const statusHeaderValue = computed(() => {
  const request = status.value?.request
  if (!request) return null
  if (status.value?.effective.source === 'cloudflare') return request.cfConnectingIp
  if (status.value?.effective.source === 'x_forwarded_for') return request.xForwardedFor
  return t('admin.system.network.diagnostics.ignored')
})

const reasonLabel = computed(() => {
  const reason: ClientIpResolutionReason = status.value?.request.reason ?? 'peer_unavailable'
  return t(`admin.system.network.diagnostics.reasons.${reason}`)
})

async function refreshStatus(): Promise<void> {
  statusLoading.value = true
  statusFailed.value = false
  try {
    status.value = await $fetch<AdminClientIpStatus>('/api/admin/settings/client-ip')
  } catch {
    statusFailed.value = true
  } finally {
    statusLoading.value = false
  }
}

function addTrustedCidr(cidr: string): void {
  if (environmentManaged.value || parsedCidrs.value.cidrs.includes(cidr)) return
  const current = form.trustedProxyCidrs.trim()
  form.trustedProxyCidrs = current ? `${current}\n${cidr}` : cidr
}

function addLocalProxyCidrs(): void {
  addTrustedCidr('127.0.0.1/32')
  addTrustedCidr('::1/128')
}

function normalizeTrustedCidrs(): void {
  if (environmentManaged.value || parsedCidrs.value.invalidEntries.length > 0) return
  form.trustedProxyCidrs = parsedCidrs.value.normalized
}

async function saveNetworkSettings(): Promise<void> {
  let saved: boolean
  if (form.clientIpSource === 'direct' && !environmentManaged.value) {
    saved = await save(['clientIpSource'], { resetKeys: ['trustedProxyCidrs', 'clientIpForwardedHops'] })
  } else {
    saved = await networkSection.save()
  }
  if (saved) await refreshStatus()
}

onMounted(() => {
  void refreshStatus()
})
</script>

<template>
  <div class="dashboard-settings-page">
    <DashboardSettingsSection
      :title="t('admin.system.network.diagnostics.title')"
      :description="t('admin.system.network.diagnostics.description')"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-refresh-cw"
          :loading="statusLoading"
          @click="refreshStatus"
        >
          {{ t('admin.system.network.diagnostics.refresh') }}
        </UButton>
      </template>

      <UAlert
        v-if="statusFailed"
        color="error"
        variant="soft"
        icon="i-mdi-alert-circle-outline"
        :title="t('admin.system.network.diagnostics.loadFailed')"
        :ui="inlineNoticeUi"
      />

      <div
        v-else
        class="client-ip-flow"
      >
        <div class="client-ip-flow-node">
          <span class="client-ip-flow-label">
            {{ t('admin.system.network.diagnostics.peer') }}
          </span>
          <code>{{ status?.request.peerIp || '—' }}</code>
        </div>

        <UIcon
          name="i-mdi-chevron-right"
          class="client-ip-flow-arrow"
        />

        <div class="client-ip-flow-node">
          <span class="client-ip-flow-label">{{ statusHeaderLabel }}</span>
          <code>{{ statusHeaderValue || '—' }}</code>
        </div>

        <UIcon
          name="i-mdi-chevron-right"
          class="client-ip-flow-arrow"
        />

        <div class="client-ip-flow-node client-ip-flow-result">
          <span class="client-ip-flow-label">
            {{ t('admin.system.network.diagnostics.resolved') }}
          </span>
          <code>{{ status?.request.clientIp || '—' }}</code>
        </div>
      </div>

      <div
        v-if="status && !statusFailed"
        class="flex flex-wrap items-center gap-2"
      >
        <UBadge
          color="neutral"
          variant="subtle"
        >
          {{ t(`admin.system.network.source.options.${status.effective.source === 'x_forwarded_for' ? 'xForwardedFor' : status.effective.source}.label`) }}
        </UBadge>
        <UBadge
          :color="status.effective.managedBy === 'environment' ? 'warning' : 'info'"
          variant="subtle"
        >
          {{ status.effective.managedBy === 'environment'
            ? t('admin.system.network.management.environment')
            : t('admin.system.network.management.database') }}
        </UBadge>
        <span class="text-sm text-muted">{{ reasonLabel }}</span>
      </div>

      <UAlert
        v-if="status?.effective.safeFallback"
        color="warning"
        variant="soft"
        icon="i-mdi-shield-alert-outline"
        :title="t('admin.system.network.diagnostics.safeFallback.title')"
        :description="t('admin.system.network.diagnostics.safeFallback.description')"
        :ui="inlineNoticeUi"
      />
    </DashboardSettingsSection>

    <DashboardSettingsSection
      :title="t('admin.system.network.settings.title')"
      :description="t('admin.system.network.settings.description')"
    >
      <UAlert
        v-if="environmentManaged"
        color="warning"
        variant="soft"
        icon="i-mdi-lock-outline"
        :title="t('admin.system.network.management.lockedTitle')"
        :description="t('admin.system.network.management.lockedDescription')"
        :ui="inlineNoticeUi"
      />

      <UFormField
        name="clientIpSource"
        :label="t('admin.system.network.source.label')"
        :description="t('admin.system.network.source.description')"
        class="flex flex-col items-stretch gap-4"
        :ui="{ container: 'w-full' }"
      >
        <URadioGroup
          v-model="activeSource"
          :items="sourceItems"
          variant="card"
          orientation="vertical"
          :disabled="environmentManaged"
          :ui="{
            fieldset: 'grid gap-3 lg:grid-cols-3',
            item: 'min-w-0 h-full'
          }"
        />
      </UFormField>

      <template v-if="requiresTrustedProxy">
        <USeparator />
        <UFormField
          name="trustedProxyCidrs"
          :label="t('admin.system.network.trusted.label')"
          :description="t('admin.system.network.trusted.description')"
          :error="trustedCidrsError"
          required
          class="flex flex-col items-stretch gap-4"
          :ui="{ container: 'w-full' }"
        >
          <div class="space-y-3">
            <div class="flex flex-wrap gap-2">
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-mdi-server-network-outline"
                :disabled="environmentManaged"
                @click="addLocalProxyCidrs"
              >
                {{ t('admin.system.network.trusted.shortcuts.localProxy') }}
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-mdi-ip-outline"
                :disabled="environmentManaged"
                @click="addTrustedCidr('0.0.0.0/0')"
              >
                {{ t('admin.system.network.trusted.shortcuts.allIpv4') }}
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                icon="i-mdi-ip-network-outline"
                :disabled="environmentManaged"
                @click="addTrustedCidr('::/0')"
              >
                {{ t('admin.system.network.trusted.shortcuts.allIpv6') }}
              </UButton>
            </div>

            <UTextarea
              v-model="activeTrustedCidrs"
              :rows="6"
              autoresize
              :maxrows="12"
              :disabled="environmentManaged"
              class="w-full font-mono text-sm"
              placeholder="127.0.0.1/32&#10;::1/128"
              @blur="normalizeTrustedCidrs"
            />

            <div
              v-if="trustsEveryAddress || activeSource === 'cloudflare'"
              class="grid gap-3 pt-1"
            >
              <UAlert
                v-if="trustsEveryAddress"
                color="warning"
                variant="soft"
                icon="i-mdi-alert-outline"
                :title="t('admin.system.network.trusted.allWarning.title')"
                :description="t('admin.system.network.trusted.allWarning.description')"
                :ui="inlineNoticeUi"
              />

              <UAlert
                v-if="activeSource === 'cloudflare'"
                color="info"
                variant="soft"
                icon="i-mdi-cloud-lock-outline"
                :title="t('admin.system.network.cloudflare.title')"
                :description="t('admin.system.network.cloudflare.description')"
                :ui="inlineNoticeUi"
              />
            </div>
          </div>
        </UFormField>
      </template>

      <template v-if="activeSource === 'x_forwarded_for'">
        <USeparator />
        <UFormField
          name="clientIpForwardedHops"
          :label="t('admin.system.network.forwardedHops.label')"
          :description="t('admin.system.network.forwardedHops.description')"
          class="flex max-sm:flex-col items-start justify-between gap-4"
        >
          <UInput
            v-model.number="activeForwardedHops"
            type="number"
            :min="1"
            :max="10"
            :disabled="environmentManaged"
            class="w-full sm:w-28"
          />
        </UFormField>
      </template>

      <template #footer>
        <AdminSettingsSectionActions
          :dirty="networkSection.dirty.value"
          :saving="networkSection.saving.value"
          :disabled="networkSection.disabled.value || environmentManaged || Boolean(trustedCidrsError)"
          @save="saveNetworkSettings"
        />
      </template>
    </DashboardSettingsSection>
  </div>
</template>

<style scoped>
.client-ip-flow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1.35fr) auto minmax(0, 1fr);
  align-items: stretch;
  gap: 0.625rem;
}

.client-ip-flow-node {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 0.35rem;
  min-height: 3rem;
  padding-block: 0.25rem;
}

.client-ip-flow-node code {
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 0.75rem;
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.client-ip-flow-result {
  color: var(--ui-primary);
}

.client-ip-flow-result code,
.client-ip-flow-result .client-ip-flow-label { color: currentColor; }

.client-ip-flow-label {
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.client-ip-flow-arrow {
  align-self: center;
  color: var(--ui-text-dimmed);
  font-size: 1.25rem;
}

@media (width < 640px) {
  .client-ip-flow {
    grid-template-columns: minmax(0, 1fr);
  }

  .client-ip-flow-arrow {
    justify-self: center;
    transform: rotate(90deg);
  }
}
</style>
