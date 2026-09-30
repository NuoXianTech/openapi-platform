<script setup lang="ts">
interface AdminOperationResourceSummaryProps {
  resourceType?: string | null
  resourceId?: string | null
  detail?: Record<string, unknown> | null
}

const props = defineProps<AdminOperationResourceSummaryProps>()
const { t, te } = useI18n()

const RESOURCE_ICON_BY_TYPE: Record<string, string> = {
  'api': 'i-mdi-api',
  'api-call-log': 'i-mdi-api',
  'api-category': 'i-mdi-shape-outline',
  'api-key': 'i-mdi-key-outline',
  'announcement': 'i-mdi-bullhorn-outline',
  'credit': 'i-mdi-wallet-outline',
  'friend-link': 'i-mdi-link-variant',
  'login-log': 'i-mdi-login-variant',
  'notification-message': 'i-mdi-bell-outline',
  'oauth-account': 'i-mdi-account-key-outline',
  'oauth-provider': 'i-mdi-connection',
  'oauth-settings': 'i-mdi-account-cog-outline',
  'operation-log': 'i-mdi-clipboard-text-clock-outline',
  'redemption-code': 'i-mdi-ticket-percent-outline',
  'redemption-code-batch': 'i-mdi-ticket-confirmation-outline',
  'site-settings': 'i-mdi-cog-outline',
  'user': 'i-mdi-account-outline'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function firstText(record: Record<string, unknown> | null): string | null {
  if (!record) return null
  for (const key of ['name', 'title', 'username', 'keyName', 'code', 'provider']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

const normalizedResourceType = computed(() => props.resourceType?.trim() || '')
const resourceTypeLabel = computed(() => {
  if (!normalizedResourceType.value) return ''
  const messageKey = `admin.logs.operations.resourceTypes.${normalizedResourceType.value.replaceAll('-', '_')}`
  return te(messageKey) ? t(messageKey) : normalizedResourceType.value
})
const resourceIcon = computed(() => RESOURCE_ICON_BY_TYPE[normalizedResourceType.value] || 'i-mdi-cube-outline')
const resourceName = computed(() => {
  const detail = props.detail
  const directName = firstText(detail || null)
  if (directName) return directName

  const keyNames = detail?.keyNames
  if (Array.isArray(keyNames)) {
    const names = keyNames.filter((value): value is string => typeof value === 'string' && !!value.trim())
    const [singleName] = names
    if (names.length === 1 && singleName) return singleName.trim()
    if (names.length > 1) return t('admin.logs.operations.resources.multiple', {
      type: resourceTypeLabel.value,
      count: names.length
    })
  }

  for (const key of ['updated', 'created', 'deleted', 'removed', 'patch']) {
    const nestedName = firstText(asRecord(detail?.[key]))
    if (nestedName) return nestedName
  }
  return null
})
const resourceIdentifier = computed(() => {
  const value = props.resourceId?.trim()
  if (!value) return ''
  if (value === 'global') return t('admin.logs.operations.resources.global')
  if (/^\d+(?:,\d+)*$/.test(value)) {
    return t('admin.logs.operations.resources.id', { value: value.replaceAll(',', ', ') })
  }
  if (value.startsWith('batch:')) {
    return t('admin.logs.operations.resources.batch', { count: value.slice('batch:'.length) })
  }
  return t('admin.logs.operations.resources.identifier', { value })
})
const primaryLabel = computed(() => resourceName.value || resourceTypeLabel.value)
const secondaryLabel = computed(() => [
  resourceName.value ? resourceTypeLabel.value : '',
  resourceIdentifier.value
].filter(Boolean).join(' · '))
const isEmpty = computed(() => !primaryLabel.value && !secondaryLabel.value)
</script>

<template>
  <span
    v-if="isEmpty"
    class="text-muted"
  >-</span>
  <div
    v-else
    class="operation-resource"
  >
    <span class="operation-resource__icon" aria-hidden="true">
      <UIcon :name="resourceIcon" class="size-3.5" />
    </span>
    <span class="operation-resource__copy">
      <UTooltip
        :text="primaryLabel"
        :content="{ side: 'top' }"
      >
        <span class="operation-resource__primary">
          {{ primaryLabel }}
        </span>
      </UTooltip>
      <UTooltip
        v-if="secondaryLabel"
        :text="secondaryLabel"
        :content="{ side: 'top' }"
      >
        <span class="operation-resource__secondary">
          {{ secondaryLabel }}
        </span>
      </UTooltip>
    </span>
  </div>
</template>

<style scoped>
.operation-resource {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.625rem;
}

.operation-resource__icon {
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid var(--ui-border-muted);
  border-radius: 6px;
  color: var(--ui-text-muted);
  background: var(--ui-bg-muted);
}

.operation-resource__copy {
  display: block;
  min-width: 0;
}

.operation-resource__primary,
.operation-resource__secondary {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.operation-resource__primary {
  color: var(--ui-text-highlighted);
  font-size: 0.75rem;
  font-weight: 600;
}

.operation-resource__secondary {
  margin-top: 0.125rem;
  color: var(--ui-text-muted);
  font-family: var(--font-code);
  font-size: 0.75rem;
}
</style>
