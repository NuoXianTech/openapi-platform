<script setup lang="ts">
definePageMeta({
  layout: {
    name: 'dashboard',
    props: {
      dashboardId: 'user'
    }
  },
  middleware: 'auth-dashboard'
})
</script>

<template>
  <CommonPageOutlet />
</template>
