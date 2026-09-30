<script setup lang="ts">
interface DashboardOverviewHeroProps {
  title: string
  description: string
}

defineProps<DashboardOverviewHeroProps>()
</script>

<template>
  <section class="dashboard-hero-surface dashboard-overview-hero relative overflow-hidden rounded-xl border border-default p-6 sm:p-8">
    <div class="relative z-10 grid gap-6 lg:min-h-48 lg:grid-cols-5">
      <div class="flex flex-col lg:col-span-3">
        <div class="space-y-3">
          <h2 class="text-2xl font-semibold tracking-tight text-highlighted sm:text-[32px] sm:leading-10">
            {{ title }}
          </h2>
          <p class="max-w-2xl text-sm leading-6 text-toned sm:text-base">
            {{ description }}
          </p>
        </div>

        <div class="mt-7 flex flex-wrap gap-2 lg:mt-auto lg:pt-6">
          <slot name="actions" />
        </div>
      </div>

      <div class="min-w-0 lg:col-span-2">
        <slot />
      </div>
    </div>
  </section>
</template>
