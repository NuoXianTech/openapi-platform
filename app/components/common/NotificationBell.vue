<script setup lang="ts">
import type { MessageLevel } from '#shared/types/content'
import { isSafePublicUrl } from '#shared/utils/safe-url'
import { MESSAGE_LEVEL_META as levelMeta } from '~/constants/message-level'
/**
 * 后台站内信通知中心（admin / user 两端共用）
 *
 * - 头像旁铃铛 + 未读角标（轮询 60s）
 * - 点击从右侧滑出 Slideover，承载完整通知列表，替代独立页面
 * - 支持「只看未读 / 全部已读 / 展开详情 / 跳转链接」
 *
 * per-user 私有数据：全部走组件本地 ref + $fetch，不进 SSR payload。
 */

interface Notification {
  id: number
  title: string
  content: string
  level: MessageLevel
  linkUrl: string | null
  isRead: boolean
  readAt: string | null
  senderActor: string | null
  createdAt: string
}

const open = ref(false)
const items = ref<Notification[]>([])
const unread = ref(0)
const loading = ref(false)
const loadFailed = ref(false)
const onlyUnread = ref(false)
const expandedId = ref<number | null>(null)
const { t, locale } = useI18n()
let listRequestVersion = 0
let listController: AbortController | null = null
let unreadRequestVersion = 0
let unreadController: AbortController | null = null

const notificationLevelClasses: Record<MessageLevel, string> = {
  info: 'notification-item__level--info',
  success: 'notification-item__level--success',
  warning: 'notification-item__level--warning',
  critical: 'notification-item__level--critical'
}

function getNotificationLevelLabel(level: MessageLevel): string {
  return t(`common.notifications.levels.${level}`)
}

function getNotificationExcerpt(content: string): string {
  return content.replace(/\s+/g, ' ').trim()
}

async function fetchUnreadCount(): Promise<void> {
  const version = ++unreadRequestVersion
  unreadController?.abort()
  const controller = new AbortController()
  unreadController = controller
  try {
    const res = await $fetch('/api/notifications/unread-count', {
      signal: controller.signal
    })
    if (version === unreadRequestVersion) unread.value = res.count
  } catch { /* ignore */ } finally {
    if (unreadController === controller) unreadController = null
  }
}

async function fetchList(): Promise<void> {
  const version = ++listRequestVersion
  listController?.abort()
  const controller = new AbortController()
  listController = controller
  loading.value = true
  loadFailed.value = false
  try {
    const res = await $fetch<Notification[]>('/api/notifications/list', {
      query: { limit: 200, unread: onlyUnread.value ? '1' : '0' },
      signal: controller.signal
    })
    if (version === listRequestVersion) items.value = res || []
  } catch {
    if (version === listRequestVersion && !controller.signal.aborted) {
      loadFailed.value = true
    }
  } finally {
    if (version === listRequestVersion) loading.value = false
    if (listController === controller) listController = null
  }
}

function cancelListRequest(): void {
  listRequestVersion += 1
  listController?.abort()
  listController = null
  loading.value = false
}

function cancelUnreadRequest(): void {
  unreadRequestVersion += 1
  unreadController?.abort()
  unreadController = null
}

async function toggleNotification(n: Notification): Promise<void> {
  const willExpand = expandedId.value !== n.id
  expandedId.value = willExpand ? n.id : null
  if (!willExpand || n.isRead) return

  try {
    cancelUnreadRequest()
    await $fetch('/api/notifications/mark-read', { method: 'POST', body: { id: n.id } })
    n.isRead = true
    n.readAt = new Date().toISOString()
    unread.value = Math.max(0, unread.value - 1)
  } catch { /* ignore */ }
}

async function markAllRead(): Promise<void> {
  try {
    cancelListRequest()
    cancelUnreadRequest()
    await $fetch('/api/notifications/mark-all-read', { method: 'POST' })
    items.value.forEach((n) => {
      if (!n.isRead) {
        n.isRead = true
        n.readAt = new Date().toISOString()
      }
    })
    unread.value = 0
    expandedId.value = null
    if (onlyUnread.value) items.value = []
  } catch { /* ignore */ }
}

function setOnlyUnread(value: boolean): void {
  if (onlyUnread.value === value) return
  onlyUnread.value = value
}

watch(open, (val) => {
  if (val) {
    void fetchList()
  } else {
    expandedId.value = null
  }
})

watch(onlyUnread, () => {
  expandedId.value = null
  if (open.value) void fetchList()
})

// 未读角标仅在客户端拉取并轮询：避免 SSR 阶段请求 per-user 私有数据并写入 payload
useIntervalFn(fetchUnreadCount, 60_000)
onMounted(() => {
  void fetchUnreadCount()
})
onBeforeUnmount(() => {
  cancelListRequest()
  cancelUnreadRequest()
})
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="$t('common.notifications.title')"
    :description="$t('common.notifications.description')"
    :ui="{
      content: 'dashboard-slideover sm:max-w-[34rem]',
      header: 'items-start gap-3 pe-14 sm:pe-16',
      wrapper: 'min-w-0 flex-1',
      body: 'p-0 sm:p-0'
    }"
  >
    <UButton
      variant="ghost"
      color="neutral"
      square
      class="notification-bell__trigger"
      :aria-label="$t('common.notifications.title')"
    >
      <UIcon
        name="i-mdi-bell-outline"
        class="size-5"
      />
      <span
        v-if="unread > 0"
        class="notification-bell__count"
      >
        {{ unread > 99 ? '99+' : unread }}
      </span>
    </UButton>

    <template #title>
      <span class="inline-flex max-w-full min-w-0 items-center gap-2">
        <span class="truncate">{{ $t('common.notifications.title') }}</span>
        <UBadge
          v-if="unread > 0"
          color="neutral"
          variant="subtle"
          size="sm"
          class="shrink-0"
        >
          {{ $t('common.notifications.unreadCount', { count: unread.toLocaleString(locale) }) }}
        </UBadge>
      </span>
    </template>

    <template #body>
      <div class="notification-center__toolbar">
        <div
          class="notification-center__filters"
          role="group"
          :aria-label="$t('common.notifications.title')"
        >
          <UButton
            size="sm"
            color="neutral"
            :variant="onlyUnread ? 'ghost' : 'soft'"
            @click="setOnlyUnread(false)"
          >
            {{ $t('common.filters.all') }}
          </UButton>
          <UButton
            size="sm"
            color="neutral"
            :variant="onlyUnread ? 'soft' : 'ghost'"
            @click="setOnlyUnread(true)"
          >
            {{ $t('common.notifications.unread') }}
          </UButton>
        </div>

        <div class="notification-center__actions">
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            icon="i-mdi-check-all"
            :disabled="unread === 0"
            @click="markAllRead"
          >
            {{ $t('common.notifications.markAllRead') }}
          </UButton>
          <UTooltip :text="$t('common.actions.refresh')">
            <UButton
              size="xs"
              color="neutral"
              variant="soft"
              square
              icon="i-lucide-refresh-cw"
              :loading="loading"
              :aria-label="$t('common.actions.refresh')"
              @click="fetchList"
            />
          </UTooltip>
        </div>
      </div>

      <div
        v-if="loading && items.length === 0"
        class="notification-center__list"
        aria-hidden="true"
      >
        <div
          v-for="index in 4"
          :key="index"
          class="notification-item notification-item--skeleton"
        >
          <USkeleton class="size-9 shrink-0 rounded-md" />
          <div class="min-w-0 flex-1 space-y-2.5">
            <USkeleton class="h-4 w-2/3 rounded-sm" />
            <USkeleton class="h-3 w-full rounded-sm" />
            <USkeleton class="h-3 w-1/2 rounded-sm" />
          </div>
        </div>
      </div>

      <div
        v-else-if="loadFailed && items.length === 0"
        class="notification-center__state"
      >
        <span class="notification-center__state-icon" aria-hidden="true">
          <UIcon name="i-mdi-cloud-alert-outline" class="size-5" />
        </span>
        <p>{{ $t('common.states.loadFailed') }}</p>
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          @click="fetchList"
        >
          {{ $t('common.actions.retry') }}
        </UButton>
      </div>

      <UEmpty
        v-else-if="items.length === 0"
        variant="naked"
        icon="i-mdi-bell-sleep-outline"
        :title="onlyUnread ? $t('common.notifications.noUnread') : $t('common.notifications.empty')"
        :description="$t('common.notifications.emptyDescription')"
        class="py-16"
      />

      <div
        v-else
        class="notification-center__list"
        :aria-busy="loading"
      >
        <article
          v-for="n in items"
          :key="n.id"
          class="notification-item"
          :class="{
            'is-unread': !n.isRead,
            'is-expanded': expandedId === n.id
          }"
        >
          <button
            type="button"
            class="notification-item__trigger"
            :aria-expanded="expandedId === n.id"
            @click="toggleNotification(n)"
          >
            <span
              class="notification-item__level"
              :class="notificationLevelClasses[n.level]"
              aria-hidden="true"
            >
              <UIcon
                :name="levelMeta[n.level].icon"
                class="size-4.5"
              />
            </span>

            <span class="notification-item__body">
              <span class="notification-item__heading">
                <span class="notification-item__title">{{ n.title }}</span>
                <span
                  v-if="!n.isRead"
                  class="notification-item__unread-dot"
                  :aria-label="$t('common.notifications.unread')"
                />
              </span>

              <span
                class="notification-item__content"
                :class="{ 'is-preview': expandedId !== n.id }"
              >
                {{ expandedId === n.id ? n.content : getNotificationExcerpt(n.content) }}
              </span>

              <span class="notification-item__meta">
                <span>{{ getNotificationLevelLabel(n.level) }}</span>
                <span aria-hidden="true">·</span>
                <span>{{ $t('common.notifications.from', { sender: n.senderActor || $t('common.notifications.system') }) }}</span>
                <span aria-hidden="true">·</span>
                <time :datetime="n.createdAt">{{ formatDateTime(n.createdAt, '-', locale) }}</time>
              </span>
            </span>

            <UIcon
              name="i-mdi-chevron-down"
              class="notification-item__chevron size-4"
              aria-hidden="true"
            />
          </button>

          <div
            v-if="expandedId === n.id && isSafePublicUrl(n.linkUrl, { allowRelative: true })"
            class="notification-item__footer"
          >
            <UButton
              :to="n.linkUrl!"
              target="_blank"
              size="xs"
              color="neutral"
              variant="outline"
              icon="i-mdi-open-in-new"
              trailing
            >
              {{ $t('common.actions.viewDetails') }}
            </UButton>
          </div>
        </article>
      </div>
    </template>
  </USlideover>
</template>

<style scoped>
.notification-bell__trigger {
  position: relative;
  min-width: 44px;
  min-height: 44px;
  justify-content: center;
}

.notification-bell__count {
  position: absolute;
  top: 0.2rem;
  right: 0.2rem;
  display: inline-flex;
  min-width: 1.25rem;
  height: 1.25rem;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--ui-bg);
  border-radius: 999px;
  padding-inline: 0.2rem;
  color: var(--ui-text-inverted);
  background: var(--ui-error);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
}

.notification-center__toolbar {
  position: sticky;
  z-index: 10;
  top: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid var(--ui-border);
  padding: 0.75rem 1rem;
  background: color-mix(in oklab, var(--ui-bg) 92%, transparent);
  backdrop-filter: blur(12px);
}

.notification-center__filters,
.notification-center__actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.notification-center__filters {
  border: 1px solid var(--ui-border);
  border-radius: 0.375rem;
  padding: 0.1875rem;
  background: var(--ui-bg-muted);
}

.notification-center__actions {
  gap: 0.5rem;
}

.notification-center__list {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 0.75rem;
}

.notification-center__state {
  display: flex;
  min-height: 18rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 2rem;
  color: var(--ui-text-muted);
  text-align: center;
  font-size: 0.875rem;
}

.notification-center__state-icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border: 1px solid var(--ui-border);
  border-radius: 0.75rem;
  color: var(--ui-text-toned);
  background: var(--ui-bg-elevated);
}

.notification-item {
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: 0.75rem;
  background: var(--ui-bg-elevated);
  box-shadow: var(--dashboard-shadow);
  transition: background-color 160ms ease;
}

.notification-item.is-unread {
  background: color-mix(in oklab, var(--ui-primary) 3%, var(--ui-bg-elevated));
}

.notification-item__trigger {
  display: grid;
  width: 100%;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.75rem;
  border: 0;
  padding: 0.875rem;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.notification-item__trigger:hover {
  background: color-mix(in oklab, var(--ui-bg-muted) 58%, transparent);
}

.notification-item__trigger:focus-visible {
  outline: 2px solid var(--ui-ring);
  outline-offset: -2px;
}

.notification-item__level {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border-radius: 0.375rem;
}

.notification-item__level--info {
  color: var(--ui-info);
  background: color-mix(in oklab, var(--ui-info) 10%, transparent);
}

.notification-item__level--success {
  color: var(--ui-success);
  background: color-mix(in oklab, var(--ui-success) 10%, transparent);
}

.notification-item__level--warning {
  color: var(--ui-warning);
  background: color-mix(in oklab, var(--ui-warning) 11%, transparent);
}

.notification-item__level--critical {
  color: var(--ui-error);
  background: color-mix(in oklab, var(--ui-error) 10%, transparent);
}

.notification-item__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.4rem;
}

.notification-item__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
}

.notification-item__title {
  min-width: 0;
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.notification-item__unread-dot {
  width: 0.4rem;
  height: 0.4rem;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--ui-primary);
}

.notification-item__content {
  color: var(--ui-text-toned);
  font-size: 0.8125rem;
  line-height: 1.65;
  white-space: pre-wrap;
}

.notification-item__content.is-preview {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  white-space: normal;
}

.notification-item__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1.4;
}

.notification-item__chevron {
  margin-top: 0.1rem;
  color: var(--ui-text-muted);
  transition: transform 160ms ease;
}

.notification-item.is-expanded .notification-item__chevron {
  transform: rotate(180deg);
}

.notification-item__footer {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--ui-border-muted);
  padding: 0.625rem 0.875rem;
  background: color-mix(in oklab, var(--ui-bg-muted) 48%, transparent);
}

.notification-item--skeleton {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.875rem;
}

@media (width < 520px) {
  .notification-center__toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .notification-center__filters,
  .notification-center__actions {
    justify-content: space-between;
  }

  .notification-center__filters :deep(button) {
    flex: 1;
    justify-content: center;
  }

  .notification-item__trigger {
    gap: 0.625rem;
    padding: 0.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .notification-item,
  .notification-item__chevron {
    transition: none;
  }
}
</style>
