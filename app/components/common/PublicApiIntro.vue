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
          <UButton :to="primaryAction.to" size="sm" trailing-icon="i-lucide-arrow-up-right" class="design-marketing-cta home-hero__button">
            {{ primaryAction.label }}
          </UButton>
          <UButton to="/docs" color="neutral" variant="outline" size="sm" class="design-marketing-cta home-hero__button home-hero__button--secondary">
            {{ $t('public.navigation.catalog') }}
          </UButton>
        </div>
      </div>

      <section class="request-demo" aria-labelledby="request-demo-title">
        <header class="request-demo__header">
          <div class="request-demo__title">
            <UIcon name="i-lucide-terminal" class="size-4" aria-hidden="true" />
            <h2 id="request-demo-title">{{ $t('public.home.hero.request') }}</h2>
          </div>
        </header>
        <div class="request-demo__request">
          <div class="request-demo__request-code">
            <div class="request-demo__address">
              <span class="request-demo__method">GET</span>
              <code :title="sampleUrl">{{ samplePath }}</code>
            </div>
          </div>
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            square
            icon="i-lucide-copy"
            :aria-label="$t('public.api.copyEndpoint')"
            class="request-demo__copy"
            @click="copyText(sampleUrl)"
          />
        </div>
        <div class="request-demo__response" :aria-busy="isRunning">
          <div class="request-demo__response-heading">
            <span class="request-demo__label">{{ $t('public.home.responsePreview') }}</span>
            <span class="request-demo__status" role="status" :class="{ 'is-running': isRunning }">
              {{ isRunning ? $t('public.home.requesting') : `200 OK · ${responseLatency}ms` }}
            </span>
          </div>
          <pre tabindex="0" :aria-label="$t('public.home.responsePreview')"><code>{{ responsePreview }}</code></pre>
        </div>
        <footer class="request-demo__footer">
          <span>{{ $t('public.home.hero.demoHint') }}</span>
          <UButton size="sm" icon="i-lucide-play" :loading="isRunning" :disabled="isRunning" class="request-demo__run" @click="runSample">
            {{ $t('public.home.runExample') }}
          </UButton>
        </footer>
      </section>
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
  padding-block: var(--design-space-section);
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
  font: var(--design-type-display-xl);
  letter-spacing: var(--design-tracking-display-xl);
}

.home-hero h1 span {
  display: block;
}

.home-hero__description {
  max-width: 560px;
  margin: 24px 0 0;
  color: var(--ui-text-toned);
  font: var(--design-type-body-lg);
  text-wrap: pretty;
}

.home-hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 24px;
}

.home-hero__button {
  min-width: 0;
  min-height: 40px;
  font: var(--design-type-button-md);
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
}

.request-demo__header {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-inline: 16px;
  border-bottom: 1px solid var(--ui-border);
}

.request-demo__title {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-highlighted);
}

.request-demo__title h2 {
  margin: 0;
  font: var(--design-type-button-md);
  letter-spacing: -0.28px;
}

.request-demo__request {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
}

.request-demo__request-code {
  min-width: 0;
  flex: 1;
}

.request-demo__address {
  display: flex;
  align-items: baseline;
  gap: 12px;
  color: var(--ui-text-highlighted);
  font: 400 14px/20px var(--font-code);
}

.request-demo__method {
  flex-shrink: 0;
  font-weight: 500;
}

.request-demo__address code {
  min-width: 0;
  overflow-wrap: anywhere;
  font: inherit;
}

.request-demo__copy {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--ui-text-toned);
  background: transparent;
  box-shadow: none;
  transition: color 160ms ease;
}

.request-demo__copy:hover,
.request-demo__copy:active {
  color: var(--ui-text-highlighted);
  background: transparent;
}

.request-demo__footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-top: 1px solid var(--ui-border);
}

.request-demo__run {
  flex-shrink: 0;
  min-height: 32px;
  margin-inline-start: auto;
  padding: 0 6px;
  border-radius: 6px;
  color: var(--ui-text-inverted);
  background: var(--ui-primary);
  font: var(--design-type-button-md);
  letter-spacing: 0;
  box-shadow: none;
}

.request-demo__footer > span {
  flex: 1 0 180px;
  color: var(--ui-text-muted);
  font-size: 12px;
  line-height: 16px;
}

.request-demo__response {
  min-width: 0;
  border-top: 1px solid var(--ui-border);
}

.request-demo__response-heading {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 0;
}

.request-demo__label {
  color: var(--ui-text-toned);
  font-size: 12px;
  line-height: 16px;
}

.request-demo__status {
  flex-shrink: 0;
  color: var(--design-badge-info);
  font: 12px/16px var(--font-code);
}

.request-demo__status.is-running {
  color: var(--ui-text-toned);
}

.request-demo pre {
  max-height: 320px;
  margin: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 16px;
  color: var(--ui-text-highlighted);
  font: 400 14px/20px var(--font-code);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  scrollbar-width: thin;
}

.home-hero :is(a, button, pre):focus-visible {
  outline: 2px solid var(--ui-ring);
  outline-offset: 4px;
}

@media (width < 1100px) {
  .home-hero__stage { gap: 40px; }
}

@media (width < 960px) {
  .home-hero__stage {
    grid-template-columns: minmax(0, 1fr);
    padding-block: 56px;
  }
}

@media (width <= 640px) {
  .home-hero__stage {
    width: calc(100% - 32px);
    gap: 32px;
    padding-block: 40px;
  }
  .home-hero__summary { gap: 12px; }
  .home-hero h1 {
    font: var(--design-type-heading-lg);
    letter-spacing: var(--design-tracking-heading-lg);
  }
  .home-hero__description {
    margin-top: 20px;
    font: var(--design-type-body-md);
  }
}

@media (width <= 640px), (pointer: coarse) {
  .home-hero__button { min-height: 44px; }
}

@media (pointer: coarse) {
  .request-demo__run { min-height: 44px; }
}
</style>
