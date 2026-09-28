<script setup lang="ts">
definePageMeta({
  layout: {
    name: 'dashboard',
    props: {
      dashboardId: 'admin'
    }
  },
  middleware: 'auth-dashboard'
})
</script>

<template>
  <div class="contents">
    <CommonPageOutlet />
    <ClientOnly>
      <LazyAdminInitialProfileModal />
    </ClientOnly>
  </div>
</template>
