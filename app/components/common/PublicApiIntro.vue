<script setup lang="ts">
import { I18nT } from 'vue-i18n'
import { TransitionPresets, usePreferredReducedMotion, useTransition } from '@vueuse/core'
import { ADMIN_OVERVIEW_PATH, USER_OVERVIEW_PATH } from '~/constants/dashboard-config'
import { formatYiyanResponseExample, PUBLIC_API_EXAMPLE_TIMESTAMP } from '~/utils/public-api-example'

const props = withDefaults(defineProps<{
  siteDescription?: string
  uptimeDays?: number | null
  showCallCount?: boolean
  callCount?: number
  summaryLoading?: boolean
  summaryError?: boolean
}>(), {
  siteDescription: '',
  uptimeDays: null,
  showCallCount: true,
  callCount: 0,
  summaryLoading: false,
  summaryError: false
})

const { t, locale } = useI18n()
const { user } = useAuth()
const { registrationEnabled, settings } = useSiteSettings()
const { copyText } = useCopyFeedback()
const requestUrl = useRequestURL()
const reducedMotion = usePreferredReducedMotion()
const isMounted = ref(false)
const callCountTarget = ref(0)
const animatedCallCount = useTransition(callCountTarget, {
  duration: 900,
  easing: TransitionPresets.easeOutCubic,
  disabled: computed(() => reducedMotion.value === 'reduce')
})
function syncCallCount(): void {
  if (!isMounted.value || !props.showCallCount || props.summaryLoading || props.summaryError) return
  callCountTarget.value = Math.max(0, props.callCount)
}

watch([
  () => props.callCount,
  () => props.showCallCount,
  () => props.summaryLoading,
  () => props.summaryError
], syncCallCount)
const callCountLoading = computed(() => !isMounted.value || props.summaryLoading)

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 0 }))
const primaryAction = computed(() => {
  if (user.value) {
    return user.value.role === 'admin'
      ? { label: t('public.home.adminDashboard'), to: ADMIN_OVERVIEW_PATH }
      : { label: t('public.home.userDashboard'), to: USER_OVERVIEW_PATH }
  }
  return registrationEnabled.value
    ? { label: t('public.navigation.getStarted'), to: '/register' }
    : { label: t('auth.login.title'), to: '/login' }
})
const formattedCallCount = computed(() => numberFormatter.value.format(Math.round(animatedCallCount.value)))
const callCountLabel = computed(() => {
  if (callCountLoading.value) return t('common.states.loading')
  if (props.summaryError) return t('common.states.loadFailed')
  return t('public.home.processedRequests', { count: numberFormatter.value.format(props.callCount) })
})
const formattedUptime = computed(() => {
  if (props.uptimeDays === null) return ''
  if (props.uptimeDays === 0) return t('public.home.uptimeLessThanDay')
  return new Intl.NumberFormat(locale.value, { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(props.uptimeDays)
})

const samplePath = '/v1/yiyan?type=a&id=a1'
const sampleUrl = computed(() => (settings.value.siteUrl || requestUrl.origin).replace(/\/$/, '') + samplePath)
const isRunning = ref(false)
const responseLatency = ref(42)
const responseTimestamp = ref(PUBLIC_API_EXAMPLE_TIMESTAMP)
const responsePreview = computed(() => formatYiyanResponseExample(t('public.home.standardResponseMessage'), responseTimestamp.value))
let sampleTimer: ReturnType<typeof setTimeout> | undefined

function createSimulatedLatency(): number {
  return Math.floor(Math.random() * 45) + 24
}

onMounted(() => {
  isMounted.value = true
  syncCallCount()
  responseLatency.value = createSimulatedLatency()
  responseTimestamp.value = Date.now()
})

function runSample(): void {
  if (isRunning.value) return
  isRunning.value = true
  const nextLatency = createSimulatedLatency()
  sampleTimer = setTimeout(() => {
    responseLatency.value = nextLatency
    responseTimestamp.value = Date.now()
    isRunning.value = false
  }, Math.max(180, nextLatency * 4))
}

onBeforeUnmount(() => clearTimeout(sampleTimer))
</script>

<template>
  <section class="home-hero" aria-labelledby="home-hero-title">
    <div class="home-hero__mesh" aria-hidden="true" />
    <div class="home-hero__stage">
      <div class="home-hero__content">
        <div v-if="formattedUptime || showCallCount" class="home-hero__summary">
          <span v-if="formattedUptime" class="home-hero__uptime">
            <UIcon name="i-lucide-clock-3" class="size-3.5" aria-hidden="true" />
            {{ $t('public.home.uptimeLabel') }}
            <strong>{{ formattedUptime }}</strong>
          </span>
          <div
            v-if="showCallCount"
            class="home-hero__request-count"
            role="group"
            :aria-busy="callCountLoading"
            :aria-label="callCountLabel"
          >
            <UIcon name="i-lucide-chart-no-axes-combined" class="size-4" aria-hidden="true" />
            <I18nT keypath="public.home.processedRequests" tag="span" scope="global" aria-hidden="true">
              <template #count>
                <span v-if="callCountLoading" class="dashboard-skeleton home-hero__count-skeleton" />
                <strong v-else-if="summaryError" :title="$t('common.states.loadFailed')">—</strong>
                <strong v-else class="home-hero__count-value">{{ formattedCallCount }}</strong>
              </template>
            </I18nT>
          </div>
        </div>
        <h1 id="home-hero-title">
          <span>{{ $t('public.home.hero.title') }}</span>
          <span>{{ $t('public.home.hero.titleAccent') }}</span>
        </h1>
        <p class="home-hero__description">{{ siteDescription || $t('public.home.defaultDescription') }}</p>
        <div class="home-hero__actions">
          <UButton :to="primaryAction.to" size="lg" trailing-icon="i-lucide-arrow-up-right" class="home-hero__button">
            {{ primaryAction.label }}
          </UButton>
          <UButton to="/docs" color="neutral" variant="outline" size="lg" class="home-hero__button home-hero__button--secondary">
            {{ $t('public.navigation.catalog') }}
          </UButton>
        </div>
      </div>

      <div class="request-demo" :aria-label="$t('public.home.simulatedExample')">
        <header class="request-demo__header">
          <div class="request-demo__tabs">
            <span class="request-demo__tab"><UIcon name="i-lucide-terminal" class="size-4" aria-hidden="true" />{{ $t('public.home.hero.request') }}</span>
            <span class="request-demo__filename">example.http</span>
          </div>
          <span class="request-demo__example-label">{{ $t('public.home.simulatedExample') }}</span>
        </header>
        <div class="request-demo__body">
          <div class="request-demo__request">
            <span class="request-demo__label">{{ $t('public.home.requestAddress') }}</span>
            <div class="request-demo__address">
              <span class="request-demo__method">GET</span>
              <code :title="sampleUrl">{{ sampleUrl }}</code>
              <UButton color="neutral" variant="ghost" square icon="i-lucide-copy" :aria-label="$t('public.api.copyEndpoint')" class="request-demo__copy" @click="copyText(sampleUrl)" />
            </div>
            <code class="request-demo__accept">Accept: application/json</code>
            <div class="request-demo__run">
              <UButton color="neutral" variant="outline" icon="i-lucide-play" :loading="isRunning" :disabled="isRunning" @click="runSample">
                {{ $t('public.home.runExample') }}
              </UButton>
              <span>{{ $t('public.home.hero.demoHint') }}</span>
            </div>
          </div>
          <div class="request-demo__response" :aria-busy="isRunning">
            <div class="request-demo__response-heading">
              <span class="request-demo__label">{{ $t('public.home.responsePreview') }}</span>
              <span class="request-demo__status">{{ isRunning ? $t('public.home.requesting') : `200 OK · ${responseLatency}ms` }}</span>
            </div>
            <pre tabindex="0" :aria-label="$t('public.home.responsePreview')"><code>{{ isRunning ? $t('public.home.requesting') : responsePreview }}</code></pre>
          </div>
        </div>
      </div>
    </div>

  </section>
</template>

<style scoped>
.home-hero {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-bg);
}

.home-hero__stage {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(420px, 500px);
  align-items: center;
  width: calc(100% - 48px);
  max-width: 1180px;
  margin-inline: auto;
  gap: 80px;
  padding-block: 80px;
}

.home-hero__mesh {
  position: absolute;
  z-index: -1;
  inset: 0 -5% -20%;
  pointer-events: none;
  opacity: 0.7;
  background:
    radial-gradient(ellipse at 4% 62%, #00dfd84d, transparent 44%),
    radial-gradient(ellipse at 28% 78%, #007cf045, transparent 42%),
    radial-gradient(ellipse at 55% 58%, #7928ca40, transparent 42%),
    radial-gradient(ellipse at 78% 64%, #ff008033, transparent 40%),
    radial-gradient(ellipse at 100% 78%, #f9cb2857, transparent 38%);
  filter: blur(36px);
  mask-image: linear-gradient(transparent, #000 26%, #000 70%, transparent);
}

.home-hero__content {
  min-width: 0;
  text-align: left;
}

.home-hero__summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 20px;
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 20px;
}

.home-hero__uptime,
.home-hero__request-count {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}

.home-hero__summary :deep(.iconify) {
  flex-shrink: 0;
}

.home-hero__request-count {
  padding: 6px 10px;
  border: 1px solid var(--ui-border);
  border-radius: 100px;
  background: var(--ui-bg-elevated);
}

.home-hero__summary strong {
  color: var(--ui-text-highlighted);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.home-hero__request-count strong {
  display: inline-block;
  margin-inline: 2px;
  font-size: 14px;
}

.home-hero__count-skeleton {
  display: inline-block;
  width: 48px;
  height: 14px;
  border-radius: 4px;
  vertical-align: middle;
}

.home-hero h1 {
  margin: 24px 0 0;
  color: var(--ui-text-highlighted);
  font-size: clamp(40px, 3.5vw, 48px);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -2.4px;
}

.home-hero h1 span {
  display: block;
}

.home-hero h1 span + span {
  margin-top: 8px;
}

.home-hero__description {
  max-width: 560px;
  margin: 24px 0 0;
  color: var(--ui-text-toned);
  font-size: 16px;
  line-height: 1.8;
  text-wrap: pretty;
}

.home-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.home-hero__button {
  min-width: 144px;
  min-height: 48px;
  justify-content: center;
  padding-inline: 24px;
  border-radius: 100px;
  font-size: 16px;
  font-weight: 500;
}

.home-hero__button--secondary {
  background: var(--ui-bg-elevated);
}

.request-demo {
  min-width: 0;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  box-shadow: 0 1px 1px #0000000a;
}

.request-demo__header {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-inline: 20px;
  border-bottom: 1px solid var(--ui-border);
}

.request-demo__tabs,
.request-demo__tab {
  display: flex;
  align-items: center;
}

.request-demo__tabs { gap: 16px; }

.request-demo__tab {
  gap: 8px;
  color: var(--ui-text-highlighted);
  font-size: 12px;
  font-weight: 500;
}

.request-demo__filename {
  color: var(--ui-text-muted);
  font: 12px/16px var(--font-code);
}

.request-demo__example-label {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.request-demo__request {
  min-width: 0;
  padding: 20px;
}

.request-demo__label {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.request-demo__address {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding-left: 12px;
  border: 1px solid var(--ui-border);
  border-radius: 6px;
  background: var(--ui-bg);
}

.request-demo__method {
  color: var(--ui-text-highlighted);
  font: 500 12px/16px var(--font-code);
}

.request-demo__address code {
  min-width: 0;
  flex: 1;
  overflow-x: auto;
  color: var(--ui-text-highlighted);
  font-size: 14px;
  line-height: 20px;
  white-space: nowrap;
  scrollbar-width: thin;
}

.request-demo__copy {
  flex-shrink: 0;
  min-width: 44px;
  min-height: 44px;
  border-radius: 6px;
}

.request-demo__accept {
  display: block;
  margin-top: 12px;
  color: var(--ui-text-muted);
  font-size: 12px;
}

.request-demo__run {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.request-demo__run > button {
  flex-shrink: 0;
  min-height: 44px;
  border-radius: 6px;
  font-size: 12px;
}

.request-demo__run > span {
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 1.6;
}

.request-demo__response {
  min-width: 0;
  border-top: 1px solid var(--ui-border);
  padding: 20px;
  background: color-mix(in srgb, var(--ui-bg) 60%, var(--ui-bg-elevated));
}

.request-demo__response-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.request-demo__status {
  color: var(--ui-text-toned);
  font: 12px/16px var(--font-code);
}

.request-demo pre {
  height: 240px;
  margin: 12px 0 0;
  overflow: auto;
  color: var(--ui-text-toned);
  font: 400 14px/20px var(--font-code);
  scrollbar-width: thin;
}

.home-hero :is(a, button, pre):focus-visible {
  outline: 2px solid var(--ui-ring);
  outline-offset: 4px;
}

@media (width < 1100px) {
  .home-hero__stage { gap: 40px; }
  .home-hero h1 { font-size: 40px; }
}

@media (width < 960px) {
  .home-hero__stage {
    grid-template-columns: minmax(0, 1fr);
    padding-block: 56px;
  }
  .home-hero h1 { font-size: 48px; }
  .request-demo pre { height: 220px; }
}

@media (width < 640px) {
  .home-hero__stage {
    width: calc(100% - 32px);
    gap: 32px;
    padding-block: 40px;
  }
  .home-hero__summary { gap: 12px; }
  .home-hero h1 {
    font-size: clamp(30px, 7.5vw, 40px);
    letter-spacing: -1.5px;
  }
  .home-hero__description {
    margin-top: 20px;
    font-size: 14px;
  }
  .home-hero__actions { margin-top: 24px; }
  .home-hero__button {
    flex: 1;
    min-width: 0;
    padding-inline: 16px;
    font-size: 14px;
  }
  .request-demo__header { padding-inline: 16px; }
  .request-demo__filename { display: none; }
  .request-demo__request,
  .request-demo__response { padding: 16px; }
  .request-demo pre { height: 200px; }
}
</style>
