<script setup lang="ts">
withDefaults(defineProps<{
  stateKey: string
  busy?: boolean
  refreshing?: boolean
}>(), {
  busy: false,
  refreshing: false
})

function leaveState(element: Element) {
  element.setAttribute('inert', '')
  element.setAttribute('aria-hidden', 'true')
}

function enterState(element: Element) {
  element.removeAttribute('inert')
  element.removeAttribute('aria-hidden')
}
</script>

<template>
  <div class="state-transition" :aria-busy="busy">
    <UProgress
      v-if="refreshing"
      size="xs"
      :aria-label="$t('common.states.loading')"
      class="state-transition__progress"
    />
    <Transition
      name="state-swap"
      @before-enter="enterState"
      @before-leave="leaveState"
      @leave-cancelled="enterState"
    >
      <div :key="stateKey" class="state-transition__content">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.state-transition {
  position: relative;
  display: grid;
  min-width: 0;
  align-items: start;
}

/* Overlap outgoing and incoming states so the region never collapses between them. */
.state-transition__content {
  grid-area: 1 / 1;
  min-width: 0;
}

.state-transition__progress {
  position: absolute;
  inset: 0 0 auto;
  z-index: 1;
}

.state-swap-enter-active {
  transition: opacity var(--motion-duration-normal) var(--motion-ease-out);
}

.state-swap-leave-active {
  pointer-events: none;
  transition: opacity var(--motion-duration-fast) ease-in;
}

.state-swap-enter-from,
.state-swap-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .state-swap-enter-active,
  .state-swap-leave-active { transition: none; }
  .state-swap-enter-from,
  .state-swap-leave-to { opacity: 1; }
}
</style>
