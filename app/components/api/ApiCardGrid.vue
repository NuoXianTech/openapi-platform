<script setup lang="ts">
import type { ApiCatalogItem, ApiCategoryItem } from '#shared/types/api'

interface ApiCardGridProps {
  apis?: ApiCatalogItem[]
  categoryMap?: Record<number, ApiCategoryItem>
}

const { apis = [], categoryMap = {} } = defineProps<ApiCardGridProps>()
</script>

<template>
  <div>
    <TransitionGroup
      name="api-card"
      tag="div"
      class="api-card-grid"
    >
      <div
        v-for="api in apis"
        :key="api.id"
        class="api-card-grid__item"
      >
        <ApiCard
          :name="api.name"
          :status="api.status"
          :category-name="api.categoryId == null ? '' : categoryMap[api.categoryId]?.name"
          :short-desc="api.shortDesc"
          :description="api.description"
          :doc-url="api.docUrl"
          :endpoints="api.endpoints"
          :total-calls="api.totalCalls"
        />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.api-card-grid {
  contain: layout style;
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  grid-auto-rows: 1fr;
  gap: 16px;
  align-items: stretch;
}

.api-card-grid__item {
  min-width: 0;
}

@media (min-width: 640px) {
  .api-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1024px) {
  .api-card-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.api-card-enter-active,
.api-card-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-ease-out), transform var(--motion-duration-normal) var(--motion-ease-out);
}

.api-card-enter-from,
.api-card-leave-to {
  opacity: 0;
  transform: translateY(var(--motion-distance));
}

.api-card-move {
  transition: transform var(--motion-duration-normal) var(--motion-ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .api-card-enter-active,
  .api-card-leave-active,
  .api-card-move {
    transition: none;
  }

  .api-card-enter-from,
  .api-card-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
