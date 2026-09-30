<script setup lang="ts">
import { API_STATUS } from '#shared/config/api-status'
import type { ApiCatalogEndpoint } from '#shared/types/api'
import ApiHttpMethodBadge from '~/components/api/HttpMethodBadge.vue'
import {
  areAllEndpointsPaid,
  getAggregateEndpointCost,
  resolveApiStatusMeta
} from '~/utils/api-presentation'
import { formatCompactCount } from '~/utils/number-format'

interface ApiCardProps {
  name?: string
  status?: number
  categoryName?: string
  shortDesc?: string
  description?: string
  docUrl?: string
  endpoints?: ApiCatalogEndpoint[]
  totalCalls?: number
}

const props = withDefaults(defineProps<ApiCardProps>(), {
  name: '',
  status: API_STATUS.unknown,
  categoryName: '',
  shortDesc: '',
  description: '',
  docUrl: '',
  endpoints: () => [],
  totalCalls: 0
})
const { t, locale } = useI18n()
const {
  name,
  categoryName,
  shortDesc,
  description,
  docUrl,
  totalCalls
} = toRefs(props)
const resolvedName = computed(() => name.value || t('public.api.defaultTitle'))
const resolvedCategoryName = computed(() => categoryName.value || t('public.api.publicCategory'))
const detailTriggerLabel = computed(() => `${t('public.api.viewDetails')} · ${resolvedName.value}`)
const detailsOpen = ref(false)
const detailTriggerElement = shallowRef<HTMLElement | null>(null)
const methods = computed(() => Array.from(new Set(
  props.endpoints.map(endpoint => endpoint.httpMethod)
)))
const primaryEndpoint = computed(() => props.endpoints[0] ?? null)
const aggregateCost = computed(() => getAggregateEndpointCost(props.endpoints))
const isAllPaid = computed(() => areAllEndpointsPaid(props.endpoints))
const pricingTooltip = computed(() => {
  if (aggregateCost.value > 0) return t('public.api.pricing.perCall', { count: aggregateCost.value })
  if (aggregateCost.value === -1) {
    return isAllPaid.value ? t('public.api.pricing.byEndpointDescription') : t('public.api.pricing.partiallyPaidDescription')
  }
  return t('public.api.pricing.freeDescription')
})
const detailSummary = computed(() => shortDesc.value || description.value || t('public.api.noSummary'))
const detailBodyDescription = computed(() => {
  const value = description.value.trim()
  return value && value !== detailSummary.value.trim() ? value : ''
})
const statusMeta = computed(() => resolveApiStatusMeta(props.status, key => t(key)))
const statusClass = computed(() => `api-card__status--${statusMeta.value.color}`)
const detailContentProps = computed(() => ({
  description: detailBodyDescription.value,
  docUrl: docUrl.value,
  endpoints: props.endpoints,
  totalCalls: totalCalls.value
}))

function openDetails(event: Event) {
  if (event.currentTarget instanceof HTMLElement) {
    detailTriggerElement.value = event.currentTarget
  }
  detailsOpen.value = true
}

function restoreDetailTriggerFocus() {
  if (detailTriggerElement.value?.isConnected) {
    detailTriggerElement.value.focus()
  }
}

function preventDetailsAutoFocus(event: Event) {
  event.preventDefault()
}
</script>

<template>
  <UCard
    variant="outline"
    class="api-card border-default bg-elevated"
    :ui="{ root: 'gap-0', body: '!p-0' }"
  >
    <div class="api-card__content">
      <header class="api-card__meta-row">
        <div class="api-card__badges">
          <ApiHttpMethodBadge
            v-for="method in methods"
            :key="method"
            :method="method"
            size="xs"
          />
          <span class="api-card__category">
            {{ resolvedCategoryName }}
          </span>
        </div>
        <span class="api-card__status" :class="statusClass">
          <span class="api-card__status-dot" aria-hidden="true" />
          {{ statusMeta.label }}
        </span>
      </header>

      <div class="api-card__copy">
        <h3 class="api-card__title">
          <button
            type="button"
            class="api-card__title-trigger"
            :aria-label="detailTriggerLabel"
            aria-haspopup="dialog"
            :aria-expanded="detailsOpen"
            @click="openDetails"
          >
            <span class="api-card__title-trigger-label">{{ resolvedName }}</span>
            <UIcon
              name="i-mdi-arrow-right"
              class="api-card__title-trigger-icon"
              aria-hidden="true"
            />
          </button>
        </h3>
        <p class="api-card__short">
          {{ detailSummary }}
        </p>
      </div>

      <div v-if="primaryEndpoint" class="api-card__endpoint">
        <code>{{ primaryEndpoint.apiPath }}</code>
        <span v-if="endpoints.length > 1" class="api-card__endpoint-count">
          {{ $t('public.api.endpointAddressCount', { count: endpoints.length }) }}
        </span>
      </div>
    </div>

    <div class="api-card__footer">
      <div class="api-card__footer-meta">
        <UTooltip
          :text="$t('public.api.totalCallsDescription', { count: totalCalls.toLocaleString(locale) })"
          :content="{ side: 'top' }"
        >
          <span class="api-card__metric">
            <UIcon name="i-mdi-trending-up" class="size-3.5" />
            {{ $t('public.api.times', { count: formatCompactCount(totalCalls, locale) }) }}
          </span>
        </UTooltip>
        <UTooltip
          :text="pricingTooltip"
          :content="{ side: 'top' }"
        >
          <span class="api-card__metric">
            <UIcon :name="aggregateCost === 0 ? 'i-mdi-check-circle-outline' : 'i-mdi-cash-multiple'" class="size-3.5" />
            <template v-if="aggregateCost > 0">
              {{ $t('public.api.pricing.pointsPerCall', { count: aggregateCost }) }}
            </template>
            <template v-else-if="aggregateCost === -1">
              {{ isAllPaid ? $t('public.api.pricing.byEndpoint') : $t('public.api.pricing.partiallyPaid') }}
            </template>
            <template v-else>
              {{ $t('public.api.pricing.free') }}
            </template>
          </span>
        </UTooltip>
      </div>
    </div>
  </UCard>

  <UModal
    v-model:open="detailsOpen"
    :content="{ onOpenAutoFocus: preventDetailsAutoFocus }"
    :close="{
      size: 'sm',
      color: 'neutral',
      variant: 'ghost',
      class: 'rounded-md'
    }"
    :ui="{
      overlay: 'bg-elevated/75',
      content: 'sm:max-w-2xl overflow-hidden rounded-xl divide-y-0 bg-elevated',
      header: 'items-start gap-3 border-b border-default py-4 ps-4 pe-14 sm:px-6 sm:pe-16',
      wrapper: 'min-w-0 flex-1',
      title: 'block min-w-0',
      description: 'mt-1.5 block min-w-0',
      close: 'top-3.5 end-4',
      body: 'p-0 sm:p-0'
    }"
    @after:leave="restoreDetailTriggerFocus"
  >
    <template #title>
      <div class="api-card__modal-heading">
        <span class="api-card__modal-context">
          <UTooltip
            :text="resolvedCategoryName"
            :content="{ side: 'top' }"
          >
            <span class="api-card__modal-category">{{ resolvedCategoryName }}</span>
          </UTooltip>
          <span
            class="api-card__modal-status"
            :class="statusClass"
          >
            <span class="api-card__status-dot" aria-hidden="true" />
            {{ statusMeta.label }}
          </span>
        </span>
        <span class="api-card__modal-title">{{ resolvedName }}</span>
      </div>
    </template>

    <template #description>
      <span class="api-card__modal-summary">{{ detailSummary }}</span>
    </template>

    <template #body>
      <ApiDetailContent v-bind="detailContentProps" />
    </template>
  </UModal>
</template>

<style scoped>
.api-card {
  display: flex;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-radius: 8px;
}

.api-card__content {
  padding: 1rem 1.25rem 0;
}

.api-card__meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.api-card__badges {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.4rem;
  overflow: hidden;
}

.api-card__category,
.api-card__status {
  display: inline-flex;
  min-height: 1.35rem;
  flex: 0 0 auto;
  align-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  padding-inline: 0.42rem;
  font-size: 0.75rem;
  line-height: 1;
  white-space: nowrap;
}

.api-card__category {
  max-width: 7.5rem;
  overflow: hidden;
  border-color: transparent;
  background: var(--ui-bg-muted);
  color: var(--ui-text-muted);
  font-weight: 500;
  text-overflow: ellipsis;
}

.api-card__status,
.api-card__modal-status {
  --api-status-color: var(--ui-text-muted);
}

.api-card__status {
  width: 5.5rem;
  gap: 0.35rem;
  border-color: color-mix(in oklab, var(--api-status-color) 28%, var(--ui-border));
  background: color-mix(in oklab, var(--api-status-color) 7%, var(--ui-bg-elevated));
  color: color-mix(in oklab, var(--api-status-color) 82%, var(--ui-text-highlighted));
  font-weight: 500;
  justify-content: center;
}

.api-card__status-dot {
  width: 0.38rem;
  height: 0.38rem;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--api-status-color);
}

.api-card__status--success { --api-status-color: var(--ui-success); }
.api-card__status--info { --api-status-color: var(--ui-info); }
.api-card__status--warning { --api-status-color: var(--ui-warning); }
.api-card__status--error { --api-status-color: var(--ui-error); }
.api-card__status--neutral { --api-status-color: var(--ui-text-muted); }

.api-card__copy {
  margin-top: 0.75rem;
}

.api-card__title {
  margin: 0;
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-card__title-trigger {
  appearance: none;
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  gap: 0.4rem;
  border: 0;
  border-radius: 4px;
  padding: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  letter-spacing: inherit;
  line-height: inherit;
  text-align: left;
}

.api-card__title-trigger-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-card__title-trigger-icon {
  width: 0.95rem;
  height: 0.95rem;
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
  transition: color 160ms ease, transform 160ms ease;
}

.api-card__title-trigger:hover .api-card__title-trigger-icon {
  color: var(--ui-text-highlighted);
  transform: translateX(2px);
}

.api-card__title-trigger:focus-visible {
  outline: 2px solid var(--ui-ring);
  outline-offset: 4px;
}

.api-card__short {
  margin: 0.35rem 0 0;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.api-card__endpoint {
  display: flex;
  min-width: 0;
  margin-top: 0.75rem;
  align-items: center;
  gap: 0.75rem;
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  background: var(--ui-bg-muted);
}

.api-card__endpoint code {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--ui-text-toned);
  font-family: var(--font-code);
  font-size: 0.875rem;
  line-height: 1.25rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-card__endpoint-count {
  flex: 0 0 auto;
  color: var(--ui-text-dimmed);
  font-size: 0.75rem;
  line-height: 1rem;
  white-space: nowrap;
}

.api-card__footer {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-top: auto;
  padding: 0.7rem 1.25rem 0.85rem;
}

.api-card__footer-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
}

.api-card__metric {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.api-card__metric :deep(svg) {
  color: var(--ui-text-dimmed);
}

.api-card__modal-heading {
  display: grid;
  gap: 0.3rem;
  min-width: 0;
}

.api-card__modal-context {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.75rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1rem;
}

.api-card__modal-category {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-card__modal-status {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.35rem;
  color: var(--ui-text-muted);
}

.api-card__modal-title {
  display: block;
  min-width: 0;
  color: var(--ui-text-highlighted);
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: 0;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

.api-card__modal-summary {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
  line-height: 1.6;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

@media (max-width: 520px) {
  .api-card__content { padding-inline: 1rem; }
  .api-card__footer { padding-inline: 1rem; }
  .api-card__footer-meta { gap: 0.75rem; }
  .api-card__modal-title { font-size: 1.25rem; }
}

@media (prefers-reduced-motion: reduce) {
  .api-card__title-trigger-icon {
    transition: none;
  }
}
</style>
