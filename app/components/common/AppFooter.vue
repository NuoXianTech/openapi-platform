<script setup lang="ts">
import SiteBrand from './SiteBrand.vue'

const { settings } = useSiteSettings()

const currentYear = new Date().getFullYear()
const startYear = computed(() => {
  const year = Number.parseInt(settings.value.startTime.slice(0, 4), 10)
  return Number.isInteger(year) && year > 0 && year <= currentYear ? year : currentYear
})
const yearLabel = computed(() =>
  startYear.value < currentYear ? `${startYear.value}-${currentYear}` : `${currentYear}`
)

const icpBeian = computed(() => settings.value.icpBeian || '')
const policeBeian = computed(() => settings.value.policeBeian || '')
const policeBeianUrl = computed(() => {
  const url = 'https://beian.mps.gov.cn/#/query/webSearch'
  const code = settings.value.policeBeianCode?.trim()
  return code ? `${url}?code=${encodeURIComponent(code)}` : url
})
const hasBeian = computed(() => Boolean(icpBeian.value || policeBeian.value))
</script>

<template>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <div class="site-footer__brand">
        <SiteBrand />
        <p class="site-footer__description">
          {{ settings.siteDescription }}
        </p>
      </div>

      <div class="site-footer__legal">
        <span>© {{ yearLabel }} {{ settings.siteName }}</span>
        <div v-if="hasBeian" class="flex flex-wrap items-center gap-x-3 gap-y-1">
          <a
            v-if="icpBeian"
            href="https://beian.miit.gov.cn"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ icpBeian }}
          </a>
          <a
            v-if="policeBeian"
            :href="policeBeianUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ policeBeian }}
          </a>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  margin-top: 4rem;
  border-top: 1px solid var(--ui-border);
  background: color-mix(in oklab, var(--ui-bg-elevated) 68%, var(--ui-bg));
}

.site-footer__inner {
  display: grid;
  width: calc(100% - 2rem);
  max-width: 1180px;
  margin-inline: auto;
  gap: 1.5rem;
  padding-block: 2.5rem 1.5rem;
}

.site-footer__brand {
  display: grid;
  min-width: 0;
  gap: 0.2rem;
}

.site-footer__description {
  max-width: 28rem;
  margin: 0;
  padding-inline-start: 2.625rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1.6;
}

.site-footer__legal a:hover { color: var(--ui-primary); }

.site-footer__legal {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  border-top: 1px solid var(--ui-border);
  padding-top: 1rem;
  color: var(--ui-text-dimmed);
  font-size: 0.7rem;
}

@media (width >= 768px) {
  .site-footer__legal {
    flex-direction: row;
    justify-content: space-between;
  }
}
</style>
