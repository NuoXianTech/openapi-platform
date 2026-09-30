<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { AdminLogRow } from '#shared/types/admin'
import ApiHttpMethodBadge from '~/components/api/HttpMethodBadge.vue'
import { ADMIN_CALL_LOG_TYPE_META } from '~/composables/admin/use-admin-call-logs-page'
import { adminModalUi } from '~/utils/admin-modal-ui'

interface QueryParameter {
  key: string
  value: string
}

type QueryView = 'parameters' | 'raw'

const props = defineProps<{
  row: AdminLogRow | null
}>()

const { t, locale } = useI18n()
const { copyText: copyWithFeedback } = useCopyFeedback()
const queryView = ref<QueryView>('parameters')

const requestTarget = computed(() => {
  if (!props.row) return ''
  return props.row.queryString
    ? `${props.row.apiPath}?${props.row.queryString}`
    : props.row.apiPath
})

const queryParameters = computed<QueryParameter[]>(() => {
  if (!props.row?.queryString) return []

  return Array.from(
    new URLSearchParams(props.row.queryString),
    ([key, value]) => ({ key, value })
  )
})

const queryViewItems = computed<TabsItem[]>(() => [
  {
    label: t('admin.logs.call.detail.parameters'),
    icon: 'i-mdi-format-list-bulleted',
    value: 'parameters'
  },
  {
    label: t('admin.logs.call.detail.raw'),
    icon: 'i-mdi-code-tags',
    value: 'raw'
  }
])

function formatBytes(value: number | null): string {
  if (value == null) return '-'
  if (value < 1024) return `${value.toLocaleString(locale.value)} B`
  if (value < 1024 * 1024) {
    return `${(value / 1024).toLocaleString(locale.value, { maximumFractionDigits: 1 })} KB`
  }
  return `${(value / 1024 / 1024).toLocaleString(locale.value, { maximumFractionDigits: 2 })} MB`
}

function statusColor(statusCode: number): 'neutral' | 'success' | 'info' | 'error' {
  if (statusCode >= 400) return 'error'
  if (statusCode >= 300) return 'info'
  if (statusCode >= 200) return 'success'
  return 'neutral'
}

async function copyText(value: string): Promise<void> {
  if (!value) return
  await copyWithFeedback(value, {
    successIcon: 'i-mdi-clipboard-check-outline',
    errorIcon: 'i-mdi-alert-circle-outline'
  })
}
</script>

<template>
  <UModal
    :title="$t('admin.logs.call.detail.title')"
    :description="props.row ? formatDateTime(props.row.createdAt, '-', locale) : undefined"
    :ui="adminModalUi({ content: 'max-w-3xl' })"
  >
    <template #body>
      <div
        v-if="props.row"
        class="space-y-5 text-sm"
      >
        <section class="overflow-hidden rounded-lg border border-default bg-elevated">
          <div class="bg-muted/40 p-4">
            <div class="flex min-w-0 items-start gap-2">
              <ApiHttpMethodBadge
                :method="props.row.method"
                class="mt-0.5"
              />
              <code class="min-w-0 flex-1 break-all font-mono text-[13px] leading-5 text-highlighted">
                {{ requestTarget }}
              </code>
              <UTooltip :text="$t('admin.logs.call.detail.copyRequest')">
                <UButton
                  icon="i-mdi-content-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="$t('admin.logs.call.detail.copyRequest')"
                  @click="copyText(requestTarget)"
                />
              </UTooltip>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs">
              <span class="font-medium text-default">{{ props.row.apiName || '-' }}</span>
              <span
                v-if="props.row.categoryName"
                class="text-muted"
              >· {{ props.row.categoryName }}</span>
              <UBadge
                :color="ADMIN_CALL_LOG_TYPE_META[props.row.type].color"
                :icon="ADMIN_CALL_LOG_TYPE_META[props.row.type].icon"
                variant="subtle"
                size="xs"
                class="ms-auto"
              >
                {{ $t(ADMIN_CALL_LOG_TYPE_META[props.row.type].messageKey) }}
              </UBadge>
              <UBadge
                v-if="!props.row.isCounted"
                color="warning"
                variant="subtle"
                size="xs"
              >
                {{ $t('admin.logs.call.outcomes.notCounted') }}
              </UBadge>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-default px-4 py-3 text-xs">
            <span>
              <span class="text-muted">{{ $t('admin.logs.call.detail.statusCode') }}</span>
              <UBadge
                :color="statusColor(props.row.statusCode)"
                variant="subtle"
                size="xs"
                class="ms-1 tabular-nums"
              >
                {{ props.row.statusCode }}
              </UBadge>
            </span>
            <span>
              <span class="text-muted">{{ $t('admin.logs.call.detail.latency') }}</span>
              <span class="ms-1 font-mono font-medium tabular-nums text-highlighted">
                {{ $t('admin.logs.call.milliseconds', { value: props.row.latencyMs.toLocaleString(locale) }) }}
              </span>
            </span>
            <span>
              <span class="text-muted">{{ $t('admin.logs.call.detail.cost') }}</span>
              <span
                class="ms-1 font-mono font-medium tabular-nums"
                :class="props.row.cost > 0 ? 'text-warning' : 'text-highlighted'"
              >
                {{ props.row.cost > 0 ? `-${props.row.cost.toLocaleString(locale)}` : $t('admin.logs.call.free') }}
              </span>
            </span>
            <span>
              <span class="text-muted">{{ $t('admin.logs.call.detail.requestSize') }}</span>
              <span class="ms-1 font-mono font-medium tabular-nums text-highlighted">{{ formatBytes(props.row.requestSize) }}</span>
            </span>
            <span>
              <span class="text-muted">{{ $t('admin.logs.call.detail.responseSize') }}</span>
              <span class="ms-1 font-mono font-medium tabular-nums text-highlighted">{{ formatBytes(props.row.responseSize) }}</span>
            </span>
          </div>
        </section>

        <UAlert
          v-if="props.row.errorCode || props.row.errorMessage"
          color="error"
          variant="subtle"
          icon="i-mdi-alert-circle-outline"
          :title="props.row.errorCode || $t('admin.logs.call.detail.error')"
          :description="props.row.errorMessage || undefined"
        />

        <section>
          <div class="mb-3 flex flex-wrap items-center gap-2">
            <h3 class="font-semibold text-highlighted">
              {{ $t('admin.logs.call.detail.queryParameters') }}
            </h3>
            <UBadge
              color="neutral"
              variant="subtle"
              size="xs"
            >
              {{ $t('admin.logs.call.detail.parameterCount', { count: queryParameters.length }) }}
            </UBadge>
            <UTabs
              v-if="props.row.queryString"
              v-model="queryView"
              :items="queryViewItems"
              :content="false"
              color="neutral"
              size="xs"
              class="w-full sm:ms-auto sm:w-auto"
              :ui="{ list: 'w-full sm:w-auto' }"
            />
          </div>

          <dl
            v-if="props.row.queryString && queryView === 'parameters'"
            class="overflow-hidden rounded-md border border-default"
          >
            <div
              v-for="(parameter, index) in queryParameters"
              :key="`${parameter.key}-${index}`"
              class="grid border-b border-default last:border-b-0 sm:grid-cols-[minmax(10rem,0.35fr)_minmax(0,1fr)]"
            >
              <dt class="border-b border-default bg-muted/40 px-3 py-2.5 font-mono text-xs font-medium break-all text-toned sm:border-e sm:border-b-0">
                {{ parameter.key }}
              </dt>
              <dd class="min-w-0 px-3 py-2.5 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-default">
                <UBadge
                  v-if="parameter.value === '[REDACTED]'"
                  color="warning"
                  variant="subtle"
                  size="xs"
                >
                  {{ parameter.value }}
                </UBadge>
                <span
                  v-else-if="parameter.value"
                  class="select-text"
                >{{ parameter.value }}</span>
                <span
                  v-else
                  class="font-sans text-muted"
                >{{ $t('admin.logs.call.detail.emptyValue') }}</span>
              </dd>
            </div>
          </dl>

          <div
            v-else-if="props.row.queryString"
            class="relative overflow-hidden rounded-md border border-default bg-muted/40"
          >
            <UTooltip :text="$t('admin.logs.call.detail.copyQuery')">
              <UButton
                icon="i-mdi-content-copy"
                color="neutral"
                variant="ghost"
                size="xs"
                class="absolute top-2 end-2"
                :aria-label="$t('admin.logs.call.detail.copyQuery')"
                @click="copyText(props.row.queryString)"
              />
            </UTooltip>
            <pre class="max-h-48 overflow-auto p-3 pe-12 font-mono text-xs leading-5 break-all whitespace-pre-wrap text-toned"><code>?{{ props.row.queryString }}</code></pre>
          </div>

          <div
            v-else
            class="flex min-h-20 items-center justify-center gap-2 border-y border-dashed border-default px-4 text-sm text-muted"
          >
            <UIcon
              name="i-mdi-code-braces"
              class="size-4"
            />
            {{ $t('admin.logs.call.detail.noQueryParameters') }}
          </div>
        </section>

        <div class="grid gap-5 border-t border-default pt-5 lg:grid-cols-2">
          <section>
            <h3 class="text-xs font-semibold text-muted">
              {{ $t('admin.logs.call.detail.identity') }}
            </h3>
            <dl class="mt-2 divide-y divide-default border-y border-default text-xs">
              <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
                <dt class="text-muted">
                  {{ $t('admin.logs.call.detail.user') }}
                </dt>
                <dd class="min-w-0 text-end">
                  <template v-if="props.row.userId">
                    <span>{{ props.row.userName || '-' }}</span>
                    <span class="ms-1 text-muted">
                      {{ props.row.userRole === 'admin'
                        ? $t('common.identities.adminWithId', { id: props.row.userId })
                        : $t('common.identities.userWithId', { id: props.row.userId }) }}
                    </span>
                  </template>
                  <span v-else>{{ $t('common.identities.anonymous') }}</span>
                </dd>
              </div>
              <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
                <dt class="text-muted">
                  {{ $t('admin.logs.call.detail.key') }}
                </dt>
                <dd class="min-w-0 text-end break-all">
                  {{ props.row.apiKeyName || (props.row.apiKeyId ? `#${props.row.apiKeyId}` : '-') }}
                </dd>
              </div>
              <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
                <dt class="text-muted">
                  {{ $t('admin.logs.call.detail.api') }}
                </dt>
                <dd class="min-w-0 text-end break-all">
                  {{ props.row.apiName || '-' }}
                  <span
                    v-if="props.row.categoryName"
                    class="ms-1 text-muted"
                  >· {{ props.row.categoryName }}</span>
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h3 class="text-xs font-semibold text-muted">
              {{ $t('admin.logs.call.detail.trace') }}
            </h3>
            <dl class="mt-2 divide-y divide-default border-y border-default text-xs">
              <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
                <dt class="text-muted">
                  {{ $t('admin.logs.call.detail.time') }}
                </dt>
                <dd class="text-end tabular-nums">
                  {{ formatDateTime(props.row.createdAt, '-', locale) }}
                </dd>
              </div>
              <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
                <dt class="text-muted">
                  {{ $t('admin.logs.call.detail.requestId') }}
                </dt>
                <dd class="min-w-0 text-end font-mono break-all">
                  {{ props.row.requestId || '-' }}
                </dd>
              </div>
              <div
                v-if="props.row.upstreamTargetUrl || props.row.upstreamTargetId"
                class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5"
              >
                <dt class="text-muted">
                  {{ $t('admin.logs.call.detail.target') }}
                </dt>
                <dd class="min-w-0 text-end font-mono break-all">
                  {{ props.row.upstreamTargetUrl || '-' }}
                </dd>
              </div>
              <div
                v-if="props.row.upstreamTargetId"
                class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5"
              >
                <dt class="text-muted">
                  {{ $t('admin.logs.call.detail.targetId') }}
                </dt>
                <dd class="min-w-0 text-end font-mono break-all">
                  {{ props.row.upstreamTargetId }}
                </dd>
              </div>
              <div class="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 py-2.5">
                <dt class="text-muted">
                  {{ $t('admin.logs.call.detail.type') }}
                </dt>
                <dd class="text-end">
                  {{ $t(ADMIN_CALL_LOG_TYPE_META[props.row.type].messageKey) }}
                </dd>
              </div>
            </dl>
          </section>
        </div>

        <section>
          <h3 class="text-xs font-semibold text-muted">
            {{ $t('admin.logs.call.detail.client') }}
          </h3>
          <dl class="mt-2 divide-y divide-default border-y border-default text-xs">
            <div class="grid gap-1 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
              <dt class="text-muted">
                {{ $t('admin.logs.call.detail.clientIp') }}
              </dt>
              <dd class="font-mono break-all sm:text-end">
                {{ props.row.ip || '-' }}
              </dd>
            </div>
            <div class="grid gap-1 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
              <dt class="text-muted">
                {{ $t('admin.logs.call.detail.userAgent') }}
              </dt>
              <dd class="font-mono leading-5 break-all sm:text-end">
                {{ props.row.userAgent || '-' }}
              </dd>
            </div>
            <div
              v-if="props.row.referer"
              class="grid gap-1 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3"
            >
              <dt class="text-muted">
                {{ $t('admin.logs.call.detail.referer') }}
              </dt>
              <dd class="font-mono leading-5 break-all sm:text-end">
                {{ props.row.referer }}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
  </UModal>
</template>
