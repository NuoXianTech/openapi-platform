<script setup lang="ts">
import type { Announcement, MessageLevel } from '#shared/types/content'
import { isSafePublicUrl } from '#shared/utils/safe-url'
import { MESSAGE_LEVEL_META as levelMeta, type MessageLevelMeta } from '~/constants/message-level'
import {
  getLatestAnnouncementRevision,
  hasNewerAnnouncement
} from '~/utils/announcement-dismissal'
/**
 * 公告弹窗：自动加载生效中的公告，按 isPinned > sortOrder > createdAt 排序，
 * 默认展开第一条，其余收起。
 *
 * 视觉沿用首页的技术面板语言：连续列表、语义状态点与代码字体时间。
 * 公告数量无上限，body 限高 60dvh 后内部滚动，头/尾固定。
 * 暗色由 --ui-* 语义变量自动适配。
 *
 * 弹出时机：组件挂载且存在生效公告时自动 open。用户选择“不再提醒”后，
 * 当前浏览器会记录公告版本；新增或更新公告后自动恢复展示，游客同样适用。
 */

// 预解析为展示项：把等级元数据与日期格式化提前算好，模板保持声明式无逻辑。
// 字段刻意避开 UAccordion 内建的 `content`（会被组件自动渲染），改用 text。
interface AnnouncementItem {
  value: string
  label: string
  color: MessageLevelMeta['color']
  levelLabel: string
  isPinned: boolean
  text: string
  linkUrl: string | null
  date: string
  dateTime: string
}

const open = ref(false)
const previousFocus = shallowRef<HTMLElement | null>(null)
const expandedIds = ref<string[]>([])
const dismissedRevision = useLocalStorage('openapi:announcement-popup:dismissed-revision', '')
const { t, locale } = useI18n()

// useFetch 全局唯一 key，多个组件实例共用一份缓存。
// lazy + server: false：不阻塞 SSR、不影响首屏 LCP，hydrate 后再拉。
const { data } = useFetch<Announcement[]>(
  '/api/announcements/list',
  {
    key: 'public-announcements',
    default: () => [],
    lazy: true,
    server: false
  }
)

const items = computed<Announcement[]>(() => data.value || [])
const latestId = computed(() => items.value[0]?.id ?? null)
const currentRevision = computed(() => getLatestAnnouncementRevision(items.value))

const accordionItems = computed<AnnouncementItem[]>(() => items.value.map(a => ({
  value: String(a.id),
  label: a.title,
  color: levelMeta[a.level].color,
  levelLabel: getAnnouncementLevelLabel(a.level),
  isPinned: a.isPinned,
  text: a.content,
  linkUrl: isSafePublicUrl(a.linkUrl, { allowRelative: true }) ? a.linkUrl : null,
  date: formatDateTime(a.createdAt, '-', locale.value),
  dateTime: a.createdAt
})))

function getAnnouncementLevelLabel(level: MessageLevel): string {
  return t(`public.announcements.levels.${level}`)
}

// 数据为 lazy 拉取：挂载时若缓存已有公告立即弹，否则等数据到来再弹。
function openIfHasAnnouncements() {
  if (!import.meta.client || items.value.length === 0) return
  if (!hasNewerAnnouncement(currentRevision.value, dismissedRevision.value)) return
  expandedIds.value = latestId.value !== null ? [String(latestId.value)] : []
  if (!open.value) {
    previousFocus.value = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  open.value = true
}

onMounted(openIfHasAnnouncements)
watch(items, openIfHasAnnouncements)

function restorePreviousFocus(event: Event) {
  event.preventDefault()
  if (previousFocus.value?.isConnected) previousFocus.value.focus()
  previousFocus.value = null
}

function dismissCurrentAnnouncements() {
  if (currentRevision.value) {
    dismissedRevision.value = currentRevision.value
  }
  open.value = false
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="$t('public.announcements.title')"
    :description="$t('public.announcements.summary', { count: items.length })"
    :content="{ onCloseAutoFocus: restorePreviousFocus }"
    :ui="{
      overlay: 'bg-elevated/70 backdrop-blur-[2px]',
      content: 'announcement-dialog rounded-xl sm:max-w-2xl',
      header: 'gap-3 ps-4 pe-14 pb-4 pt-5 sm:ps-5 sm:pe-14',
      wrapper: 'min-w-0 flex-1',
      title: 'font-display text-lg leading-tight font-semibold text-highlighted',
      description: 'mt-1 text-xs leading-5 text-muted',
      body: 'max-h-[58dvh] p-4 sm:max-h-[62dvh] sm:p-5',
      footer: 'p-4 sm:px-5'
    }"
  >
    <template #actions>
      <span
        class="announcement-heading-mark order-first"
        aria-hidden="true"
      >
        <UIcon
          name="i-mdi-bullhorn-outline"
          class="size-5"
        />
        <span class="announcement-heading-mark__signal" />
      </span>
    </template>

    <template #body>
      <div
        v-if="items.length === 0"
        class="py-10 text-center text-sm text-muted"
      >
        {{ $t('public.announcements.empty') }}
      </div>

      <UAccordion
        v-else
        v-model="expandedIds"
        :items="accordionItems"
        type="multiple"
        :ui="{
          root: 'overflow-hidden rounded-xl border border-default bg-elevated',
          item: 'border-b border-default last:border-b-0',
          trigger: 'design-focus-inset gap-2 rounded-none px-4 py-3.5 hover:bg-muted/70 focus-visible:bg-accented',
          trailingIcon: 'size-4 text-dimmed',
          body: 'px-4 pb-4 pt-0'
        }"
      >
        <template #default="{ item }">
          <div class="announcement-summary">
            <div class="announcement-summary__title-row">
              <span
                class="announcement-level-signal"
                :class="`is-${item.color}`"
                aria-hidden="true"
              />
              <span class="announcement-summary__title">
                {{ item.label }}
              </span>
              <UBadge
                v-if="item.isPinned"
                color="warning"
                variant="soft"
                size="sm"
                icon="i-mdi-pin"
              >
                {{ $t('public.announcements.pinned') }}
              </UBadge>
            </div>

            <div class="announcement-summary__meta">
              <span
                class="announcement-level-label"
                :class="`is-${item.color}`"
              >
                {{ item.levelLabel }}
              </span>
              <span aria-hidden="true">·</span>
              <time
                :datetime="item.dateTime"
                class="announcement-summary__date"
              >
                {{ item.date }}
              </time>
            </div>
          </div>
        </template>

        <template #body="{ item }">
          <div class="announcement-detail">
            <p>{{ item.text }}</p>
            <a
              v-if="item.linkUrl"
              :href="item.linkUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="announcement-detail__link"
            >
              <span>{{ $t('public.announcements.viewDetails') }}</span>
              <UIcon
                name="i-mdi-arrow-top-right"
                class="size-3.5"
              />
            </a>
          </div>
        </template>
      </UAccordion>
    </template>

    <template #footer>
      <div class="announcement-footer">
        <div class="announcement-footer__actions">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            class="flex-1 justify-center sm:flex-none"
            @click="dismissCurrentAnnouncements"
          >
            {{ $t('public.announcements.dismiss') }}
          </UButton>
          <UButton
            size="sm"
            icon="i-mdi-check"
            class="flex-1 justify-center sm:flex-none"
            @click="open = false"
          >
            {{ $t('public.announcements.acknowledge') }}
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
:global(.announcement-dialog::before) {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  left: 0;
  height: 3px;
  background: var(--ui-primary);
  content: '';
}

.announcement-heading-mark {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  border: 1px solid var(--ui-border);
  border-radius: 12px;
  background: var(--ui-bg-elevated);
  color: var(--ui-text-highlighted);
  box-shadow: 0 1px 2px color-mix(in oklab, var(--ui-text) 7%, transparent);
}

.announcement-heading-mark__signal {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ui-bg);
  border-radius: 999px;
  background: var(--ui-primary);
}

.announcement-summary {
  min-width: 0;
  flex: 1;
  text-align: start;
}

.announcement-summary__title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
}

.announcement-summary__title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--ui-text-highlighted);
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.25rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.announcement-level-signal {
  width: 0.5rem;
  height: 0.5rem;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--announcement-level-color, var(--ui-text-muted));
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--announcement-level-color, var(--ui-text-muted)) 11%, transparent);
}

.announcement-summary__meta {
  display: flex;
  margin-top: 0.375rem;
  margin-left: 1rem;
  align-items: center;
  gap: 0.375rem;
  overflow: hidden;
  color: var(--ui-text-dimmed);
  font-size: 0.75rem;
  line-height: 1rem;
}

.announcement-level-label {
  flex: 0 0 auto;
  color: var(--announcement-level-color, var(--ui-text-muted));
  font-weight: 500;
}

.announcement-summary__date {
  overflow: hidden;
  font-family: var(--font-code);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.is-info { --announcement-level-color: var(--ui-info); }
.is-success { --announcement-level-color: var(--ui-success); }
.is-warning { --announcement-level-color: var(--ui-warning); }
.is-error { --announcement-level-color: var(--ui-error); }

.announcement-detail {
  margin-top: 0.125rem;
  margin-left: 1rem;
  border-top: 1px solid color-mix(in oklab, var(--ui-border) 84%, transparent);
  padding-top: 0.875rem;
}

.announcement-detail p {
  margin: 0;
  color: var(--ui-text-toned);
  font-size: 0.875rem;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.announcement-detail__link {
  display: inline-flex;
  margin-top: 0.875rem;
  align-items: center;
  gap: 0.25rem;
  border-radius: 6px;
  color: var(--ui-info);
  font-size: 0.75rem;
  font-weight: 500;
  transition: color 150ms ease;
}

.announcement-detail__link:hover {
  color: color-mix(in oklab, var(--ui-info) 76%, var(--ui-text-highlighted));
}

.announcement-detail__link:focus-visible {
  outline: 2px solid var(--ui-ring);
  outline-offset: 3px;
}

.announcement-footer {
  display: flex;
  width: 100%;
  justify-content: flex-end;
}

.announcement-footer__actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

@media (width < 640px) {
  .announcement-heading-mark {
    width: 36px;
    height: 36px;
    border-radius: 12px;
  }

  .announcement-footer__actions {
    width: 100%;
  }

  .announcement-detail {
    margin-left: 0;
  }
}
</style>
