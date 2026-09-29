<script setup lang="ts">
import type { FriendLinkItem } from '#shared/types/content'

interface LinkListProps {
  items?: FriendLinkItem[]
}

const props = withDefaults(defineProps<LinkListProps>(), {
  items: () => []
})
</script>

<template>
  <TransitionGroup
    name="link-card-item"
    tag="div"
    class="link-grid"
  >
    <LinkCard
      v-for="(item, index) in props.items"
      :key="item.id ?? index"
      :title="item.title"
      :description="item.description || undefined"
      :url="item.url"
      :status="item.isActive ? 1 : 0"
      class="link-card-item"
    />
  </TransitionGroup>
</template>

<style scoped>
.link-grid {
  display: grid;
  grid-template-columns: repeat(1, minmax(0, 1fr));
  gap: 16px;
  align-items: stretch;
}

@media (min-width: 640px) {
  .link-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (min-width: 1024px) {
  .link-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.link-card-item-enter-active,
.link-card-item-leave-active {
  transition: opacity var(--motion-duration-normal) var(--motion-ease-out), transform var(--motion-duration-normal) var(--motion-ease-out);
}

.link-card-item-enter-from,
.link-card-item-leave-to {
  opacity: 0;
  transform: translateY(var(--motion-distance));
}

.link-card-item-move {
  transition: transform var(--motion-duration-normal) var(--motion-ease-out);
}

@media (prefers-reduced-motion: reduce) {
  .link-card-item-enter-active,
  .link-card-item-leave-active,
  .link-card-item-move {
    transition: none;
  }

  .link-card-item-enter-from,
  .link-card-item-leave-to {
    opacity: 1;
    transform: none;
  }
}
</style>
