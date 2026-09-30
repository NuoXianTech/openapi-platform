import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import type { MessageLevel } from '#shared/types/content'
import { usePrivateResource } from '~/composables/dashboard/use-private-resource'

interface NotificationItem {
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

/** Lists, counters and writes share one lifecycle. A read cannot cross a write;
 * the next authoritative snapshot is requested only after the write completes. */
export function useNotifications() {
  const open = ref(false)
  const onlyUnread = ref(false)
  const expandedId = ref<number | null>(null)
  const busy = ref(false)
  const mutationError = shallowRef<unknown>(null)
  const list = usePrivateResource<NotificationItem[]>({
    path: '/api/notifications/list', defaultData: () => [], immediate: false,
    query: () => ({ limit: 200, unread: onlyUnread.value ? '1' : '0' })
  })
  const count = usePrivateResource<{ count: number }>({
    path: '/api/notifications/unread-count', defaultData: () => ({ count: 0 }), immediate: false
  })

  async function fetchUnreadCount() {
    if (!busy.value) await count.refresh()
  }
  async function fetchList() {
    if (!busy.value) await list.refresh()
  }
  function invalidateReads() {
    list.invalidate()
    count.invalidate()
  }

  async function markRead(id: number | null) {
    if (busy.value || list.disposed.value) return
    busy.value = true
    mutationError.value = null
    invalidateReads()
    try {
      if (id === null) {
        await $fetch('/api/notifications/mark-all-read', { method: 'POST' })
      } else {
        await $fetch('/api/notifications/mark-read', { method: 'POST', body: { id } })
      }
      if (list.disposed.value) return
      for (const item of list.data.value) {
        if (id === null || item.id === id) {
          item.isRead = true
          item.readAt = new Date().toISOString()
        }
      }
      if (id === null) expandedId.value = null
    } catch (error: unknown) {
      if (!list.disposed.value) mutationError.value = error
    } finally {
      invalidateReads()
      busy.value = false
      if (!list.disposed.value) {
        await Promise.all([fetchUnreadCount(), open.value ? fetchList() : Promise.resolve()])
      }
    }
  }

  async function toggleNotification(item: NotificationItem) {
    if (busy.value || list.disposed.value) return
    const expanding = expandedId.value !== item.id
    expandedId.value = expanding ? item.id : null
    if (expanding && !item.isRead) await markRead(item.id)
  }
  function setOnlyUnread(value: boolean) { onlyUnread.value = value }

  watch(open, (value) => {
    if (value) void fetchList()
    else { expandedId.value = null; list.invalidate() }
  })
  watch(onlyUnread, () => {
    expandedId.value = null
    list.invalidate()
    list.data.value = []
    if (open.value) void fetchList()
  })
  useIntervalFn(fetchUnreadCount, 60_000)
  onMounted(() => { void fetchUnreadCount() })

  return {
    open, onlyUnread, expandedId, busy, mutationError,
    items: list.data, unread: computed(() => count.data.value.count),
    loading: list.loading, loadFailed: computed(() => list.status.value === 'error'),
    fetchList, toggleNotification, setOnlyUnread, markAllRead: () => markRead(null)
  }
}
