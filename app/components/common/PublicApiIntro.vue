<script setup lang="ts">
import { TransitionPresets, usePreferredReducedMotion, useTransition } from '@vueuse/core'
import { I18nT } from 'vue-i18n'
import ApiHttpMethodBadge from '~/components/api/HttpMethodBadge.vue'
import { USER_OVERVIEW_PATH } from '~/constants/dashboard-config'
import {
  formatYiyanResponseExample,
  PUBLIC_API_EXAMPLE_TIMESTAMP
} from '~/utils/public-api-example'

interface Props {
  siteDescription?: string
  uptimeDays?: number | null
  showCallCount?: boolean
  callCount?: number
  summaryLoading?: boolean
  summaryError?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  siteDescription: '',
  uptimeDays: null,
  showCallCount: true,
  callCount: 0,
  summaryLoading: false,
  summaryError: false
})

const { t, locale } = useI18n()
const { user } = useAuth()
const { registrationEnabled } = useSiteSettings()
const { copyText } = useCopyFeedback()
const requestUrl = useRequestURL()
const preferredReducedMotion = usePreferredReducedMotion()
const isMounted = ref(false)
const transitionDisabled = computed(() => preferredReducedMotion.value === 'reduce')
const callCountTarget = ref(0)
const isCallCountAnimating = ref(false)
const animatedCallCount = useTransition(callCountTarget, {
  duration: 900,
  transition: TransitionPresets.easeOutCubic,
  disabled: transitionDisabled,
  onStarted: () => {
    isCallCountAnimating.value = true
  },
  onFinished: () => {
    isCallCountAnimating.value = false
  }
})

function syncAnimatedCallCount(): void {
  if (!isMounted.value || !props.showCallCount || props.summaryLoading || props.summaryError) return
  callCountTarget.value = Math.max(0, props.callCount)
}

watch(
  [
    () => props.callCount,
    () => props.showCallCount,
    () => props.summaryLoading,
    () => props.summaryError
  ],
  syncAnimatedCallCount
)

watch(preferredReducedMotion, (value) => {
  if (value !== 'reduce') return
  isCallCountAnimating.value = false
})

const resolvedDescription = computed(() => props.siteDescription || t('public.home.defaultDescription'))
const callCountFormatter = computed(() => new Intl.NumberFormat(locale.value, {
  notation: 'standard',
  useGrouping: true,
  maximumFractionDigits: 0
}))
const formattedCallCount = computed(() => callCountFormatter.value.format(Math.round(animatedCallCount.value)))
const callCountLoading = computed(() => !isMounted.value || props.summaryLoading)
const callCountLabel = computed(() => {
  if (callCountLoading.value) return t('common.states.loading')
  if (props.summaryError) return t('common.states.loadFailed')
  return t('public.home.processedRequests', { count: callCountFormatter.value.format(props.callCount) })
})
const uptimeParts = computed<Intl.NumberFormatPart[]>(() => {
  const days = props.uptimeDays
  if (days === null) return []
  if (days === 0) return [{ type: 'literal', value: t('public.home.uptimeLessThanDay') }]

  const parts = new Intl.NumberFormat(locale.value, {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long'
  }).formatToParts(days)

  const unitIndex = parts.findIndex(part => part.type === 'unit')
  if (unitIndex > 0 && !/\s$/.test(parts[unitIndex - 1]?.value || '')) {
    parts.splice(unitIndex, 0, { type: 'literal', value: ' ' })
  }
  return parts
})
const samplePath = '/v1/yiyan?type=a&id=a1'
const sampleUrl = computed(() => `${requestUrl.origin}${samplePath}`)
const isRunning = ref(false)
const hasResponse = ref(true)
const responseLatency = ref(42)
const responseTimestamp = ref(PUBLIC_API_EXAMPLE_TIMESTAMP)

const primaryAction = computed(() => {
  if (user.value) {
    return { label: t('public.home.userDashboard'), to: USER_OVERVIEW_PATH, icon: 'i-mdi-account-circle-outline' }
  }
  return registrationEnabled.value
    ? { label: t('public.navigation.getStarted'), to: '/register', icon: 'i-mdi-key-outline' }
    : { label: t('auth.login.title'), to: '/login', icon: 'i-mdi-login' }
})

const responsePreview = computed(() => formatYiyanResponseExample(
  t('public.home.standardResponseMessage'),
  responseTimestamp.value
))

function createSimulatedLatency(): number {
  return Math.floor(Math.random() * 45) + 24
}

onMounted(() => {
  isMounted.value = true
  syncAnimatedCallCount()

  responseLatency.value = createSimulatedLatency()
  responseTimestamp.value = Date.now()
})

async function runSample(): Promise<void> {
  if (isRunning.value) return
  isRunning.value = true
  hasResponse.value = false
  const nextLatency = createSimulatedLatency()
  await new Promise(resolve => setTimeout(resolve, Math.max(180, nextLatency * 4)))
  responseLatency.value = nextLatency
  responseTimestamp.value = Date.now()
  hasResponse.value = true
  isRunning.value = false
}

async function copyRequest(): Promise<void> {
  await copyText(sampleUrl.value)
}
</script>

<template>
  <section class="public-api-intro" aria-labelledby="public-api-intro-title">
    <div class="public-api-intro__grid" aria-hidden="true" />

    <div class="public-api-intro__layout">
      <div class="public-api-intro__content">
        <div v-if="uptimeParts.length || showCallCount" class="public-api-intro__status-row">
          <div class="public-api-intro__status" role="status">
            <span v-if="uptimeParts.length" class="public-api-intro__uptime">
              <UIcon name="i-mdi-clock-outline" class="public-api-intro__status-icon" aria-hidden="true" />
              <span>{{ $t('public.home.uptimeLabel') }}</span>
              <span class="public-api-intro__uptime-duration">
                <template v-for="(part, index) in uptimeParts" :key="index">
                  <strong v-if="part.type === 'integer' || part.type === 'group'" class="public-api-intro__uptime-value">{{ part.value }}</strong>
                  <span v-else>{{ part.value }}</span>
                </template>
              </span>
            </span>
            <span
              v-if="showCallCount"
              class="public-api-intro__request-count"
              role="group"
              :aria-busy="callCountLoading"
              :aria-label="callCountLabel"
            >
              <UIcon name="i-mdi-chart-line" class="public-api-intro__status-icon" aria-hidden="true" />
              <I18nT
                keypath="public.home.processedRequests"
                tag="span"
                scope="global"
                class="public-api-intro__request-text"
                aria-hidden="true"
              >
                <template #count>
                  <span
                    v-if="callCountLoading"
                    class="dashboard-skeleton public-api-intro__count-skeleton"
                  />
                  <strong v-else-if="summaryError" :title="$t('common.states.loadFailed')">--</strong>
                  <strong
                    v-else
                    class="public-api-intro__count-value"
                    :class="{ 'is-updating': isCallCountAnimating }"
                  >{{ formattedCallCount }}</strong>
                </template>
              </I18nT>
            </span>
          </div>
        </div>

        <h1 id="public-api-intro-title" class="public-api-intro__title">
          {{ $t('public.home.introTitle') }}
        </h1>

        <p class="public-api-intro__description">
          {{ resolvedDescription }}
        </p>

        <div class="public-api-intro__actions">
          <UButton :to="primaryAction.to" size="lg" :icon="primaryAction.icon">
            {{ primaryAction.label }}
          </UButton>
          <UButton
            to="/docs"
            size="lg"
            color="neutral"
            variant="outline"
            icon="i-mdi-book-open-page-variant-outline"
          >
            {{ $t('public.navigation.catalog') }}
          </UButton>
        </div>
      </div>

      <div class="api-request-demo" :aria-label="$t('public.home.simulatedExample')">
        <div class="api-request-demo__header">
          <div class="api-request-demo__title">
            <span class="api-request-demo__status" aria-hidden="true" />
            <span>{{ $t('public.home.simulatedExample') }}</span>
          </div>
          <span class="api-request-demo__endpoint">yiyan</span>
        </div>

        <div class="api-request-demo__request">
          <span class="api-request-demo__label">{{ $t('public.home.requestAddress') }}</span>
          <div class="api-request-demo__address">
            <ApiHttpMethodBadge method="GET" size="xs" />
            <code>{{ sampleUrl }}</code>
            <UTooltip :text="$t('common.actions.copy')">
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                square
                icon="i-mdi-content-copy"
                :aria-label="$t('common.actions.copy')"
                @click="copyRequest"
              />
            </UTooltip>
          </div>
          <UButton
            size="sm"
            icon="i-mdi-play"
            :loading="isRunning"
            :disabled="isRunning"
            class="self-start"
            @click="runSample"
          >
            {{ $t('public.home.sendRequest') }}
          </UButton>
        </div>

        <div class="api-request-demo__response">
          <div class="api-request-demo__response-head">
            <span>{{ $t('public.home.responsePreview') }}</span>
            <span v-if="hasResponse && !isRunning" class="api-request-demo__ok">200 OK · {{ responseLatency }}ms</span>
          </div>
          <pre><code>{{ isRunning ? $t('public.home.requesting') : responsePreview }}</code></pre>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.public-api-intro {
  position: relative;
  overflow: hidden;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.public-api-intro__grid {
  display: none;
}

.public-api-intro__layout {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: calc(100% - 2rem);
  max-width: 1180px;
  margin-inline: auto;
  gap: 3.5rem;
  padding-block: 4rem;
}

.public-api-intro__content {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
}

.public-api-intro__status-row {
  display: flex;
  max-width: 100%;
}

.public-api-intro__status {
  display: inline-flex;
  max-width: 100%;
  min-height: 1.75rem;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.375rem 0.875rem;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  padding: 0.375rem 0.75rem;
  color: var(--ui-text-muted);
  background: var(--ui-bg-elevated);
  font-size: 0.75rem;
}

.public-api-intro__uptime,
.public-api-intro__request-count { display: inline-flex; align-items: flex-start; gap: 0.375rem; }
.public-api-intro__uptime { white-space: nowrap; }
.public-api-intro__request-count { min-width: 0; max-width: 100%; }
.public-api-intro__request-text { min-width: 0; overflow-wrap: anywhere; }
.public-api-intro__status-icon { width: 0.875rem; height: 0.875rem; flex-shrink: 0; margin-top: 0.125rem; color: var(--ui-text-highlighted); }
.public-api-intro__uptime-value { color: var(--ui-text-highlighted); font-weight: 650; font-variant-numeric: tabular-nums; }
.public-api-intro__request-count strong { margin-inline: 0.2em; color: var(--ui-text-highlighted); font: 650 0.75rem var(--font-code); white-space: nowrap; }

.public-api-intro__title {
  width: 100%;
  max-width: 11.5em;
  margin-top: 0;
  color: var(--ui-text-highlighted);
  font-size: 2.65rem;
  font-weight: 650;
  line-height: 1.1;
}

.public-api-intro__status-row + .public-api-intro__title { margin-top: 1.5rem; }

.public-api-intro__description {
  max-width: 35rem;
  margin-top: 1.25rem;
  color: var(--ui-text-muted);
  font-size: 1rem;
  line-height: 1.75;
}

.public-api-intro__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.75rem;
}

.public-api-intro__count-value { display: inline-block; transform-origin: left center; font-variant-numeric: tabular-nums; }
.public-api-intro__count-value.is-updating { color: var(--ui-primary); animation: metric-tick 900ms cubic-bezier(0.22, 1, 0.36, 1); }

.public-api-intro__count-skeleton {
  display: inline-block;
  width: 5rem;
  height: 0.75rem;
  margin-inline: 0.2em;
  border-radius: 4px;
  vertical-align: middle;
}

.api-request-demo {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  box-shadow:
    0 0 0 16px var(--ui-bg-muted),
    0 20px 48px -42px color-mix(in oklab, var(--brand-ink) 32%, transparent);
}

.api-request-demo__header,
.api-request-demo__response-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.api-request-demo__header {
  min-height: 3rem;
  border-bottom: 1px solid var(--ui-border);
  padding: 0.625rem 1rem;
}

.api-request-demo__title { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.8125rem; font-weight: 650; }
.api-request-demo__status { width: 0.5rem; height: 0.5rem; border-radius: 50%; background: var(--ui-primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ui-primary) 10%, transparent); }
.api-request-demo__endpoint { overflow: hidden; border: 1px solid var(--ui-border); border-radius: 6px; padding: 0.25rem 0.5rem; color: var(--ui-text-muted); background: var(--ui-bg-muted); font: 0.65rem var(--font-code); text-overflow: ellipsis; white-space: nowrap; }

.api-request-demo__request { display: flex; flex-direction: column; gap: 0.75rem; border-bottom: 1px solid var(--ui-border); padding: 1rem; background: color-mix(in oklab, var(--ui-bg-muted) 60%, var(--ui-bg-elevated)); }
.api-request-demo__label { color: var(--ui-text-muted); font-size: 0.7rem; }
.api-request-demo__address { display: flex; min-width: 0; min-height: 2.5rem; align-items: center; gap: 0.65rem; border: 1px solid var(--ui-border); border-radius: 7px; padding: 0.25rem 0.35rem 0.25rem 0.75rem; background: var(--ui-bg-elevated); }
.api-request-demo__address code { min-width: 0; flex: 1; overflow-x: auto; color: var(--ui-text-toned); font-size: 0.68rem; white-space: nowrap; scrollbar-width: none; }

.api-request-demo__response { padding: 1rem; }
.api-request-demo__response-head { margin-bottom: 0.625rem; color: var(--ui-text-muted); font-size: 0.7rem; }
.api-request-demo__ok { color: var(--ui-text-highlighted); font-family: var(--font-code); }
.api-request-demo pre { height: 15rem; margin: 0; overflow: auto; border-radius: 7px; padding: 0.875rem; color: var(--ui-text-toned); background: var(--ui-bg-muted); font-size: 0.7rem; line-height: 1.65; }

@media (width >= 960px) {
  .public-api-intro__layout { grid-template-columns: minmax(0, 1fr) minmax(420px, 500px); align-items: center; gap: 6rem; padding-block: 5.25rem; }
}

@media (width < 640px) {
  .public-api-intro__layout { gap: 2.25rem; padding-block: 2.75rem; }
  .public-api-intro__title { font-size: 2rem; }
  .public-api-intro__status-row + .public-api-intro__title { margin-top: 1.25rem; }
  .public-api-intro__description { margin-top: 1rem; font-size: 0.875rem; line-height: 1.65; }
  .public-api-intro__actions { margin-top: 1.35rem; }
  .api-request-demo { box-shadow: 0 0 0 8px var(--ui-bg-muted); }
  .api-request-demo pre { height: 12rem; }
}

@media (prefers-reduced-motion: reduce) {
  .public-api-intro__count-value.is-updating { animation: none; }
}

@keyframes metric-tick {
  0%, 100% { transform: translateY(0) scale(1); }
  42% { transform: translateY(-0.18rem) scale(1.035); }
}
</style>
