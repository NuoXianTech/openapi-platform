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
    <section class="auth-panel">
      <SiteBrand
        v-if="showBrand"
        size="auth"
        class="auth-home"
      />

      <div class="auth-form-wrap motion-enter">
        <slot />
      </div>
    </section>
  </main>
</template>

<style>
.auth-shell {
  --auth-control-size: 2.25rem;
  display: flex;
  min-height: 100vh;
  min-height: 100dvh;
  flex-direction: column;
  color: var(--ui-text);
  background: var(--ui-bg);
}

.auth-panel {
  --auth-page-gutter: max(1.5rem, env(safe-area-inset-top), env(safe-area-inset-bottom));
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  /* Auto margins center short forms and collapse to zero for scrollable long forms. */
  margin-block: auto;
  padding: var(--auth-page-gutter) max(1rem, env(safe-area-inset-left), env(safe-area-inset-right));
}

.auth-home {
  margin-bottom: 1.5rem;
}

.auth-home .site-brand__mark {
  border-radius: 12px;
  border-color: var(--ui-border);
  background: var(--ui-bg-elevated);
  box-shadow: var(--auth-card-shadow);
}

.auth-home .site-brand__copy strong {
  font-weight: 600;
}

.auth-form-wrap {
  width: 100%;
  min-width: 0;
  max-width: 400px;
  box-sizing: border-box;
}

.auth-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
  text-align: center;
}

.auth-brand__logo {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  color: var(--ui-primary);
  background: var(--ui-bg-elevated);
}

.auth-brand__title {
  max-width: 25rem;
  margin: 0;
  color: var(--ui-text-highlighted);
  font-size: 1.25rem;
  font-weight: 600;
  line-height: 1.75rem;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}

.auth-brand__subtitle {
  max-width: 23rem;
  margin: 0.5rem 0 0;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1rem;
}

.auth-card {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  border-radius: 12px;
  border-color: var(--ui-border);
  background: var(--ui-bg-elevated);
  box-shadow: var(--auth-card-shadow);
}

.auth-shell :focus-visible {
  outline: 2px solid var(--ui-ring);
  outline-offset: 2px;
}

.auth-button {
  min-width: var(--auth-control-size);
  min-height: var(--auth-control-size);
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.25rem;
}

.auth-input {
  min-height: var(--auth-control-size);
  border-radius: 6px;
  background: var(--ui-bg-elevated);
  font-size: 0.875rem;
  line-height: 1.25rem;
}

.auth-input-wrapper:has(.auth-input-trailing > button) .auth-input {
  padding-inline-end: calc(var(--auth-control-size) + 0.25rem);
}

.auth-input-trailing:has(> button) {
  padding-inline-end: 0;
}

.auth-input-trailing > button {
  width: var(--auth-control-size);
  height: var(--auth-control-size);
  padding: 0;
}

.auth-control-skeleton {
  height: var(--auth-control-size);
}

.auth-inline-link {
  color: var(--ui-info);
}

.auth-divider {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--ui-text-dimmed);
  font-size: 0.75rem;
  line-height: 1rem;
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
  flex-wrap: wrap;
  margin-top: 1rem;
  align-items: center;
  justify-content: center;
  gap: 0 0.5rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1rem;
}

.auth-text-button,
.auth-footer-links .auth-button {
  min-width: 0;
  min-height: 1.5rem;
  padding-block: 0;
  font-size: 0.75rem;
  line-height: 1rem;
}

.auth-footer-links a:hover,
.auth-footer-links button:hover { color: var(--ui-primary); }

.auth-form-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.auth-message {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.875rem;
  line-height: 1.25rem;
  overflow-wrap: anywhere;
}

.auth-message__icon {
  flex-shrink: 0;
  margin-top: 0.125rem;
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

@media (pointer: coarse) {
  .auth-shell { --auth-control-size: 2.75rem; }

  /* Keep iOS from zooming the form when a field receives focus. */
  .auth-input { font-size: 1rem; }

  .auth-text-button,
  .auth-footer-links .auth-button {
  min-width: var(--auth-control-size);
  min-height: var(--auth-control-size);
  }

  .auth-checkbox-label {
  min-height: 2.75rem;
  padding-block: 0.75rem;
  }
}

</style>
