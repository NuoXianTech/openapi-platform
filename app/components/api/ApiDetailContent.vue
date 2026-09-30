<script setup lang="ts">
import type { ApiCatalogEndpoint } from '#shared/types/api'
import { isSafePublicUrl } from '#shared/utils/safe-url'

import ApiHttpMethodBadge from '~/components/api/HttpMethodBadge.vue'
import {
  areAllEndpointsPaid,
  getAggregateEndpointCost,
  resolveApiStatusMeta
} from '~/utils/api-presentation'
import { formatCompactCount } from '~/utils/number-format'

interface ApiDetailContentProps {
  description?: string
  docUrl?: string
  endpoints: ApiCatalogEndpoint[]
  totalCalls: number
}

const props = withDefaults(defineProps<ApiDetailContentProps>(), {
  description: '',
  docUrl: ''
})

const { t, locale } = useI18n()
const { copyText } = useCopyFeedback()
const requestUrl = useRequestURL()
const safeDocUrl = computed(() => (
  isSafePublicUrl(props.docUrl, { allowRelative: true }) ? props.docUrl : ''
))
const authenticationSummary = computed(() => {
  if (props.endpoints.every(endpoint => endpoint.isApiKey)) {
    return t('public.api.apiKey')
  }
  if (props.endpoints.some(endpoint => endpoint.isApiKey)) {
    return t('public.api.mixedAuthentication')
  }
  return t('public.api.noApiKey')
})
const pricingSummary = computed(() => {
  const cost = getAggregateEndpointCost(props.endpoints)
  if (cost === 0) return t('public.api.pricing.free')
  if (cost > 0) {
    return t('public.api.pricing.pointsPerCall', { count: cost })
  }
  return areAllEndpointsPaid(props.endpoints)
    ? t('public.api.pricing.byEndpoint')
    : t('public.api.pricing.partiallyPaid')
})

function endpointUrl(endpoint: ApiCatalogEndpoint) {
  try {
    return new URL(endpoint.apiPath, `${requestUrl.origin}/`).toString()
  } catch {
    return endpoint.apiPath
  }
}

function endpointStatus(endpoint: ApiCatalogEndpoint) {
  return resolveApiStatusMeta(endpoint.status, key => t(key))
}

function endpointStatusClass(endpoint: ApiCatalogEndpoint) {
  return `api-detail__endpoint-status--${endpointStatus(endpoint).color}`
}

async function copyEndpoint(endpoint: ApiCatalogEndpoint) {
  await copyText(endpointUrl(endpoint))
}
</script>

<template>
  <div class="api-detail">
    <section class="api-detail__section" aria-labelledby="api-detail-endpoints">
      <header class="api-detail__section-heading">
        <div>
          <h3 id="api-detail-endpoints">
            {{ $t('public.api.endpoint') }}
          </h3>
          <p>{{ $t('public.api.endpoints', { count: endpoints.length }) }}</p>
        </div>
      </header>

      <div class="api-detail__endpoint-list">
        <article
          v-for="endpoint in endpoints"
          :key="endpoint.id"
          class="api-detail__endpoint"
        >
          <div class="api-detail__endpoint-request">
            <ApiHttpMethodBadge :method="endpoint.httpMethod" />
            <code tabindex="0" :title="endpointUrl(endpoint)">
              {{ endpointUrl(endpoint) }}
            </code>
            <UTooltip :text="$t('public.api.copyEndpoint')">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-copy"
                class="api-detail__copy-button"
                :aria-label="$t('public.api.copyEndpoint')"
                @click="copyEndpoint(endpoint)"
              />
            </UTooltip>
          </div>

          <div class="api-detail__endpoint-meta">
            <span
              class="api-detail__endpoint-status"
              :class="endpointStatusClass(endpoint)"
            >
              <span aria-hidden="true" />
              {{ endpointStatus(endpoint).label }}
            </span>
            <span>
              <UIcon
                :name="endpoint.isApiKey ? 'i-lucide-key-round' : 'i-lucide-lock-open'"
                class="size-3.5"
                aria-hidden="true"
              />
              {{ endpoint.isApiKey ? $t('public.api.apiKey') : $t('public.api.noApiKey') }}
            </span>
            <span>
              <UIcon name="i-lucide-circle-dollar-sign" class="size-3.5" aria-hidden="true" />
              {{ endpoint.creditsCost > 0
                ? $t('public.api.pricing.pointsPerCall', { count: endpoint.creditsCost })
                : $t('public.api.pricing.free') }}
            </span>
          </div>
        </article>
      </div>
    </section>

    <dl class="api-detail__facts">
      <div>
        <dt>{{ $t('public.api.endpointCount') }}</dt>
        <dd>{{ endpoints.length }}</dd>
      </div>
      <div>
        <dt>{{ $t('public.api.authentication') }}</dt>
        <dd>{{ authenticationSummary }}</dd>
      </div>
      <div>
        <dt>{{ $t('public.api.pricing.label') }}</dt>
        <dd>{{ pricingSummary }}</dd>
      </div>
      <UTooltip
        :text="$t('public.api.totalCallsDescription', { count: totalCalls.toLocaleString(locale) })"
      >
        <div>
          <dt>{{ $t('public.api.callCount') }}</dt>
          <dd>{{ $t('public.api.times', { count: formatCompactCount(totalCalls, locale) }) }}</dd>
        </div>
      </UTooltip>
    </dl>

    <section v-if="description" class="api-detail__description">
      <h3>{{ $t('public.api.descriptionLabel') }}</h3>
      <p>{{ description }}</p>
    </section>

    <footer v-if="safeDocUrl" class="api-detail__footer">
      <UButton
        :to="safeDocUrl"
        target="_blank"
        rel="noopener noreferrer"
        color="neutral"
        variant="outline"
        size="md"
        trailing-icon="i-lucide-external-link"
        class="api-detail__doc-button"
      >
        {{ $t('public.api.openDocumentation') }}
      </UButton>
    </footer>
  </div>
</template>

<style scoped>
.api-detail {
  background: var(--ui-bg-elevated);
}

.api-detail__section {
  padding: 1.25rem 1.5rem 1.5rem;
}

.api-detail__section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.875rem;
}

.api-detail__section-heading h3,
.api-detail__description h3 {
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 0.8125rem;
  font-weight: 600;
  line-height: 1.25rem;
}

.api-detail__section-heading p {
  margin: 0.125rem 0 0;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1.25rem;
}

.api-detail__endpoint-list {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
}

.api-detail__endpoint {
  min-width: 0;
  padding: 0.875rem 1rem;
}

.api-detail__endpoint + .api-detail__endpoint {
  border-top: 1px solid var(--ui-border);
}

.api-detail__endpoint-request {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
}

.api-detail__endpoint-request code {
  min-width: 0;
  overflow-x: auto;
  color: var(--ui-text-toned);
  font-family: var(--font-code);
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.25rem;
  white-space: nowrap;
  scrollbar-width: thin;
}

.api-detail__copy-button {
  flex: 0 0 auto;
  color: var(--ui-text-muted);
}

.api-detail__endpoint-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  margin-top: 0.5rem;
  padding-left: 3.7rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1rem;
}

.api-detail__endpoint-meta > span {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}

.api-detail__endpoint-meta :deep(svg) {
  color: var(--ui-text-dimmed);
}

.api-detail__endpoint-status {
  --endpoint-status-color: var(--ui-text-muted);
}

.api-detail__endpoint-status > span {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 999px;
  background: var(--endpoint-status-color);
}

.api-detail__endpoint-status--success { --endpoint-status-color: var(--ui-success); }
.api-detail__endpoint-status--info { --endpoint-status-color: var(--ui-info); }
.api-detail__endpoint-status--warning { --endpoint-status-color: var(--ui-warning); }
.api-detail__endpoint-status--error { --endpoint-status-color: var(--ui-error); }
.api-detail__endpoint-status--neutral { --endpoint-status-color: var(--ui-text-muted); }

.api-detail__facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0;
  border-block: 1px solid var(--ui-border);
}

.api-detail__facts > div {
  display: grid;
  min-width: 0;
  gap: 0.25rem;
  padding: 0.875rem 1rem;
}

.api-detail__facts > div + div {
  border-left: 1px solid var(--ui-border);
}

.api-detail__facts dt {
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1rem;
}

.api-detail__facts dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 0.8125rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1.25rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-detail__description {
  padding: 1.25rem 1.5rem;
}

.api-detail__description p {
  margin: 0.5rem 0 0;
  color: var(--ui-text-toned);
  font-size: 0.875rem;
  line-height: 1.75;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.api-detail__footer {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--ui-border);
  padding: 1rem 1.5rem calc(1rem + env(safe-area-inset-bottom));
}

@media (max-width: 639px) {
  .api-detail__section,
  .api-detail__description {
    padding-inline: 1rem;
  }

  .api-detail__endpoint {
    padding-inline: 0.75rem;
  }

  .api-detail__endpoint-request {
    gap: 0.5rem;
  }

  .api-detail__endpoint-meta {
    padding-left: 0;
  }

  .api-detail__facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .api-detail__facts > div:nth-child(odd) {
    border-left: 0;
  }

  .api-detail__facts > div:nth-child(n + 3) {
    border-top: 1px solid var(--ui-border);
  }

  .api-detail__footer {
    padding-inline: 1rem;
  }

  .api-detail__doc-button {
    width: 100%;
    justify-content: center;
  }
}
</style>
