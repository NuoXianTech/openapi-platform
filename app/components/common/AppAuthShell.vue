<script setup lang="ts">
import SiteBrand from './SiteBrand.vue'

withDefaults(defineProps<{
  showBrand?: boolean
}>(), {
  showBrand: true
})
</script>

<template>
  <main class="auth-shell">
    <div class="auth-shell__grid" aria-hidden="true" />

    <section class="auth-panel">
      <SiteBrand
        v-if="showBrand"
        size="auth"
        class="auth-home"
      />

      <div class="auth-form-wrap">
        <slot />
      </div>
    </section>
  </main>
</template>

<style>
.auth-shell {
  position: relative;
  display: grid;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  background: var(--ui-bg);
}

.auth-shell__grid {
  display: none;
}

.auth-panel {
  position: relative;
  z-index: 1;
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: max(2rem, env(safe-area-inset-top)) 1rem max(2rem, env(safe-area-inset-bottom));
}

.auth-home {
  margin-bottom: 1.75rem;
}

.auth-form-wrap {
  width: 100%;
  min-width: 0;
  max-width: 430px;
  box-sizing: border-box;
  animation: auth-fade-in 320ms ease-out;
}

.auth-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 1.375rem;
  text-align: center;
}

.auth-brand__logo {
  display: grid;
  width: 2.625rem;
  height: 2.625rem;
  place-items: center;
  border: 1px solid color-mix(in oklab, var(--ui-primary) 20%, var(--ui-border));
  border-radius: 9px;
  color: var(--ui-primary);
  background: color-mix(in oklab, var(--ui-primary) 8%, var(--ui-bg-elevated));
}

.auth-brand__title {
  max-width: 25rem;
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 1.625rem;
  font-weight: 650;
  line-height: 1.25;
}

.auth-brand__subtitle {
  max-width: 23rem;
  margin: 0.15rem 0 0;
  color: var(--ui-text-muted);
  font-size: 0.8125rem;
  line-height: 1.6;
}

.auth-card {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  border-radius: 10px;
  border-color: var(--ui-border);
  background: color-mix(in oklab, var(--ui-bg-elevated) 96%, transparent);
  box-shadow: 0 18px 48px -38px color-mix(in oklab, var(--brand-ink) 42%, transparent);
}

.auth-card input:focus-visible {
  outline: none;
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--ui-text-dimmed);
  font-size: 0.68rem;
}

.auth-divider::before,
.auth-divider::after {
  width: 100%;
  height: 1px;
  content: "";
  background: var(--ui-border);
}

.auth-footer-links {
  display: flex;
  margin-top: 1rem;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  color: var(--ui-text-muted);
  font-size: 0.78rem;
}

.auth-footer-links a:hover,
.auth-footer-links button:hover { color: var(--ui-primary); }

.auth-form-options {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding-block: 0.125rem;
}

.auth-message {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  border: 1px solid transparent;
  border-radius: 7px;
  padding: 0.625rem 0.75rem;
  font-size: 0.78rem;
  line-height: 1.5;
}

.auth-message--error {
  border-color: color-mix(in oklab, var(--ui-error) 20%, transparent);
  color: var(--ui-error);
  background: color-mix(in oklab, var(--ui-error) 7%, transparent);
}

.auth-message--success {
  border-color: color-mix(in oklab, var(--ui-success) 20%, transparent);
  color: var(--ui-success);
  background: color-mix(in oklab, var(--ui-success) 7%, transparent);
}

.auth-success-illustration {
  display: grid;
  width: 4rem;
  height: 4rem;
  margin: 0 auto 0.25rem;
  place-items: center;
  border: 1px solid color-mix(in oklab, var(--ui-success) 24%, transparent);
  border-radius: 50%;
  color: var(--ui-success);
  background: color-mix(in oklab, var(--ui-success) 10%, transparent);
}

@media (width < 520px) {
  .auth-panel { justify-content: flex-start; padding-top: max(1.5rem, env(safe-area-inset-top)); }
  .auth-home { margin-bottom: 1.25rem; }
  .auth-brand__title { font-size: 1.4rem; }
}

@media (prefers-reduced-motion: reduce) {
  .auth-form-wrap { animation: none; }
}

@keyframes auth-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
