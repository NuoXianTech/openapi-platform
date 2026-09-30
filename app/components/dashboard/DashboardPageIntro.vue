<script setup lang="ts">
defineProps<{
  title: string
  description: string
  surface?: boolean
}>()
</script>

<template>
  <section
    :class="surface
      ? 'dashboard-hero-surface relative overflow-hidden rounded-xl border border-default p-4 sm:p-6'
      : undefined"
  >
    <div
      class="flex flex-col"
      :class="surface
        ? 'relative z-10 gap-4 lg:flex-row lg:items-end lg:justify-between'
        : 'gap-3 sm:flex-row sm:items-end sm:justify-between'"
    >
      <div class="min-w-0">
        <h2
          class="font-semibold text-highlighted"
          :class="surface ? 'text-xl leading-7 sm:text-2xl sm:leading-8' : 'text-xl leading-7'"
        >
          {{ title }}
        </h2>
        <p
          class="mt-1 text-sm"
          :class="surface ? 'text-toned' : 'max-w-3xl leading-6 text-muted'"
        >
          {{ description }}
        </p>
      </div>

      <div
        v-if="$slots.actions"
        class="flex shrink-0 flex-wrap gap-2"
      >
        <slot name="actions" />
      </div>
    </div>
  </section>
</template>
