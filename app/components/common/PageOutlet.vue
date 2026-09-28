<template>
  <NuxtPage v-slot="{ Component }">
    <div class="page-outlet">
      <!-- DashboardPanel also renders a resize handle; transition a real element. -->
      <component :is="Component" />
    </div>
  </NuxtPage>
</template>

<style scoped>
.page-outlet {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
</style>
