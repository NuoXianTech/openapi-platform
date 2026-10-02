<script setup lang="ts">
import { parseFetchError } from '~/utils/client-error'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { useApiKeys } from '~/composables/api/use-api-keys'
import { useApiKeyDisplay } from '~/composables/api/use-api-key-display'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { useClientPagination } from '~/composables/dashboard/use-client-pagination'
import { useDashboardColumnVisibility } from '~/composables/dashboard/use-dashboard-column-visibility'
import { adminModalUi } from '~/utils/admin-modal-ui'
import type { ApiKeyItem, CreatedApiKeyItem } from '#shared/types/api'

const { t, locale } = useI18n()

useHead({ title: () => t('user.apiKeys.title') })

const toast = useToast()
const { copyText } = useCopyFeedback()
const revealedKeys = ref<Record<number, string>>({})
const revealingKeyIds = reactive(new Set<number>())
const revealControllers = new Map<number, AbortController>()
const revealVersions = new Map<number, number>()
const {
  getIpText,
  getQuotaText,
  getScopesText,
  getStatus,
  getStatusCode
} = useApiKeyDisplay()

const {
  items, loading, scopeSelectItems, scopeLabelMap,
  form: formState, formError, ipLineErrors, formOpen, submitting: submittingForm, isCreating,
  openCreate, openEdit, submitForm, openReset, toggleActive, remove: openDelete
} = useApiKeys({ scope: 'user', onKeyRevoked: forgetRevealedKey })

function forgetRevealedKey(id: number) {
  cancelReveal(id)
  const { [id]: _forgotten, ...remaining } = revealedKeys.value
  revealedKeys.value = remaining
}

function cancelReveal(id: number) {
  revealVersions.set(id, (revealVersions.get(id) ?? 0) + 1)
  revealControllers.get(id)?.abort()
  revealControllers.delete(id)
  revealingKeyIds.delete(id)
}

async function toggleKeyVisibility(row: ApiKeyItem) {
  if (revealedKeys.value[row.id]) {
    forgetRevealedKey(row.id)
    return
  }
  if (revealingKeyIds.has(row.id)) return

  const version = (revealVersions.get(row.id) ?? 0) + 1
  revealVersions.set(row.id, version)
  const controller = new AbortController()
  revealControllers.set(row.id, controller)
  revealingKeyIds.add(row.id)
  try {
    const revealed = await $fetch<CreatedApiKeyItem>(
      '/api/user/apikeys/reveal',
      { method: 'POST', body: { id: row.id }, signal: controller.signal }
    )
    if (revealVersions.get(row.id) !== version) return
    revealedKeys.value = {
      ...revealedKeys.value,
      [row.id]: revealed.apiKey
    }
  } catch (err) {
    if (controller.signal.aborted || revealVersions.get(row.id) !== version) return
    toast.add({
      title: parseFetchError(err, t('user.apiKeys.revealFailed')),
      color: 'error'
    })
  } finally {
    if (revealVersions.get(row.id) === version) {
      revealControllers.delete(row.id)
      revealingKeyIds.delete(row.id)
    }
  }
}

onBeforeUnmount(() => {
  for (const id of revealControllers.keys()) cancelReveal(id)
})

async function copyRevealedKey(id: number) {
  const apiKey = revealedKeys.value[id]
  if (apiKey) await copyText(apiKey)
}

// ------------------------------------------------------------
// 展示辅助
// ------------------------------------------------------------
const columns = computed<TableColumn<ApiKeyItem>[]>(() => [
  { accessorKey: 'name', header: t('common.apiKeys.columns.name') },
  { accessorKey: 'keyPreview', header: t('user.apiKeys.title') },
  { id: 'quota', header: t('common.apiKeys.columns.quota') },
  { id: 'scopes', header: t('common.apiKeys.columns.scopes') },
  { id: 'ipWhitelist', header: t('common.apiKeys.columns.ipWhitelist') },
  { accessorKey: 'totalCalls', header: t('common.apiKeys.columns.totalCalls') },
  { accessorKey: 'lastUsedAt', header: t('common.apiKeys.columns.lastUsedAt') },
  { accessorKey: 'createdAt', header: t('common.apiKeys.columns.createdAt') },
  { accessorKey: 'expiresAt', header: t('common.apiKeys.columns.expiresAt') },
  { id: 'status', header: t('common.apiKeys.columns.status') },
  { id: 'actions', header: '' }
])
const keyword = ref('')
const statusFilter = ref<'all' | 'enabled' | 'disabled' | 'expired'>('all')
const scopeFilter = ref<'all' | 'full' | 'limited'>('all')

const statusItems = computed(() => [
  { label: t('user.apiKeys.filters.allStatuses'), value: 'all' },
  { label: t('common.apiKeys.statuses.enabled'), value: 'enabled' },
  { label: t('common.apiKeys.statuses.disabled'), value: 'disabled' },
  { label: t('common.apiKeys.statuses.expired'), value: 'expired' }
])

const scopeFilterItems = computed(() => [
  { label: t('user.apiKeys.filters.allScopes'), value: 'all' },
  { label: t('common.apiKeys.scopes.all'), value: 'full' },
  { label: t('common.apiKeys.scopes.selected'), value: 'limited' }
])

const activeFilterCount = computed(() => [
  statusFilter.value !== 'all',
  scopeFilter.value !== 'all'
].filter(Boolean).length)

const filteredItems = computed(() => {
  const q = keyword.value.trim().toLowerCase()
  return items.value.filter((item) => {
    const status = getStatus(item)
    const hasLimitedScopes = !!item.scopes?.length
    const matchesKeyword = !q || [
      item.name || t('common.apiKeys.defaultName'),
      item.keyPreview,
      status.label,
      item.lastUsedIp || '',
      ...(item.scopes || []),
      ...(item.ipWhitelist || [])
    ].some(value => value.toLowerCase().includes(q))

    const matchesStatus = statusFilter.value === 'all'
      || statusFilter.value === getStatusCode(item)

    const matchesScope = scopeFilter.value === 'all'
      || (scopeFilter.value === 'full' && !hasLimitedScopes)
      || (scopeFilter.value === 'limited' && hasLimitedScopes)

    return matchesKeyword && matchesStatus && matchesScope
  })
})

const { page, pageSize, total, paginated } = useClientPagination(filteredItems)

const { columnVisibility, columnVisibilityItems } = useDashboardColumnVisibility(columns)
columnVisibility.value = {
  quota: false,
  scopes: false,
  ipWhitelist: false,
  expiresAt: false
}

watch([keyword, statusFilter, scopeFilter, pageSize], () => {
  page.value = 1
})

function resetFilters() {
  statusFilter.value = 'all'
  scopeFilter.value = 'all'
}

function getRowItems(row: ApiKeyItem): DropdownMenuItem[] {
  return [
    { label: t('common.apiKeys.actions.edit'), icon: 'i-mdi-pencil-outline', onSelect: () => openEdit(row) },
    {
      label: row.isActive ? t('common.apiKeys.actions.disable') : t('common.apiKeys.actions.enable'),
      icon: row.isActive ? 'i-mdi-pause-circle-outline' : 'i-mdi-play-circle-outline',
      onSelect: () => toggleActive(row)
    },
    { label: t('common.apiKeys.actions.reset'), icon: 'i-lucide-refresh-cw', onSelect: () => openReset(row) },
    {
      label: t('common.apiKeys.actions.delete'),
      icon: 'i-mdi-delete-outline',
      color: 'error',
      onSelect: () => openDelete(row)
    }
  ]
}
</script>

<template>
  <UDashboardPanel id="user-apikeys">
    <template #header>
      <DashboardPageNavbar :title="$t('user.apiKeys.title')" />
    </template>

    <template #body>
      <div class="dashboard-section-page space-y-6">
        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model="keyword"
            icon="i-mdi-magnify"
            :placeholder="$t('user.apiKeys.searchPlaceholder')"
            class="w-full sm:w-72"
          />
          <AdminFilterPopover
            :active-count="activeFilterCount"
            @reset="resetFilters"
          >
            <UFormField :label="$t('common.apiKeys.columns.status')">
              <USelect
                v-model="statusFilter"
                :items="statusItems"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('common.apiKeys.columns.scopes')">
              <USelect
                v-model="scopeFilter"
                :items="scopeFilterItems"
                class="w-full"
              />
            </UFormField>
          </AdminFilterPopover>

          <div class="ml-auto flex flex-wrap items-center gap-2">
            <UButton
              icon="i-mdi-plus"
              @click="openCreate"
            >
              {{ $t('user.apiKeys.createAction') }}
            </UButton>
            <UDropdownMenu
              :items="columnVisibilityItems"
              :content="{ align: 'end' }"
            >
              <UButton
                :label="$t('user.apiKeys.showColumns')"
                color="neutral"
                variant="outline"
                icon="i-mdi-view-column-outline"
              />
            </UDropdownMenu>
          </div>
        </div>

        <DashboardTableCard
          :title="$t('user.apiKeys.listTitle')"
          icon="i-mdi-key-outline"
        >
          <DashboardDataTable
            v-model:page="page"
            v-model:page-size="pageSize"
            v-model:column-visibility="columnVisibility"
            :data="paginated"
            :columns="columns"
            :loading="loading"
            :total="total"
            :page-size-options="PAGE_SIZE_OPTIONS"
            :fixed="false"
            :empty-title="$t('user.apiKeys.empty')"
            empty-icon="i-mdi-key-outline"
          >
            <template #name-cell="{ row }">
              <span class="font-medium">{{ row.original.name || $t('common.apiKeys.defaultName') }}</span>
            </template>

            <template #keyPreview-cell="{ row }">
              <div class="flex w-64 min-w-0 items-center gap-1">
                <code class="block min-w-0 flex-1 truncate rounded-md border border-muted bg-muted px-2.5 py-1.5 font-mono text-xs text-toned">
                  {{ revealedKeys[row.original.id] || row.original.keyPreview }}
                </code>
                <UTooltip
                  :text="$t(revealedKeys[row.original.id] ? 'common.apiKeys.actions.hide' : 'common.apiKeys.actions.view')"
                >
                  <UButton
                    :icon="revealedKeys[row.original.id] ? 'i-mdi-eye-off-outline' : 'i-mdi-eye-outline'"
                    :loading="revealingKeyIds.has(row.original.id)"
                    :aria-label="$t(revealedKeys[row.original.id] ? 'common.apiKeys.actions.hide' : 'common.apiKeys.actions.view')"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="toggleKeyVisibility(row.original)"
                  />
                </UTooltip>
                <UTooltip
                  v-if="revealedKeys[row.original.id]"
                  :text="$t('common.apiKeys.actions.copy')"
                >
                  <UButton
                    icon="i-lucide-copy"
                    :aria-label="$t('common.apiKeys.actions.copy')"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    @click="copyRevealedKey(row.original.id)"
                  />
                </UTooltip>
              </div>
            </template>

            <template #quota-cell="{ row }">
              <span
                class="tabular-nums text-xs"
                :class="row.original.totalQuota === null ? 'text-muted' : ''"
              >{{ getQuotaText(row.original) }}</span>
            </template>

            <template #scopes-cell="{ row }">
              <UTooltip
                v-if="row.original.scopes && row.original.scopes.length > 0"
                :text="row.original.scopes.map(s => scopeLabelMap.get(s) || s).join('\n')"
                :content="{ side: 'top' }"
              >
                <UBadge
                  variant="soft"
                  color="neutral"
                  class="cursor-help"
                >
                  {{ getScopesText(row.original.scopes, scopeLabelMap) }}
                </UBadge>
              </UTooltip>
              <span
                v-else
                class="text-xs text-muted"
              >{{ $t('common.apiKeys.scopes.all') }}</span>
            </template>

            <template #ipWhitelist-cell="{ row }">
              <UTooltip
                v-if="row.original.ipWhitelist && row.original.ipWhitelist.length > 0"
                :text="row.original.ipWhitelist.join('\n')"
                :content="{ side: 'top' }"
              >
                <UBadge
                  variant="soft"
                  color="neutral"
                  class="cursor-help font-mono"
                >
                  {{ getIpText(row.original.ipWhitelist) }}
                </UBadge>
              </UTooltip>
              <span
                v-else
                class="text-xs text-muted"
              >{{ $t('common.apiKeys.display.allIps') }}</span>
            </template>

            <template #totalCalls-cell="{ row }">
              <span class="tabular-nums">{{ (row.original.totalCalls || 0).toLocaleString(locale) }}</span>
            </template>

            <template #lastUsedAt-cell="{ row }">
              <div class="flex flex-col text-xs">
                <span>{{ formatDateTime(row.original.lastUsedAt, $t('common.apiKeys.display.neverUsed'), locale) }}</span>
                <span
                  v-if="row.original.lastUsedIp"
                  class="text-muted font-mono"
                >{{ row.original.lastUsedIp }}</span>
              </div>
            </template>

            <template #createdAt-cell="{ row }">
              <span class="text-xs text-muted">{{ formatDateTime(row.original.createdAt, '-', locale) }}</span>
            </template>

            <template #expiresAt-cell="{ row }">
              <span
                class="text-xs"
                :class="isApiKeyExpired(row.original) ? 'text-warning' : 'text-muted'"
              >{{ formatDateTime(row.original.expiresAt, '—', locale) }}</span>
            </template>

            <template #status-cell="{ row }">
              <UBadge
                :color="getStatus(row.original).color"
                variant="subtle"
              >
                {{ getStatus(row.original).label }}
              </UBadge>
            </template>

            <template #actions-cell="{ row }">
              <div class="text-right">
                <UDropdownMenu
                  :items="getRowItems(row.original)"
                  :content="{ align: 'end' }"
                >
                  <UButton
                    icon="i-mdi-dots-vertical"
                    :aria-label="$t('common.apiKeys.actions.more', { name: row.original.name || $t('common.apiKeys.defaultName'), id: row.original.id })"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                  />
                </UDropdownMenu>
              </div>
            </template>
          </DashboardDataTable>
        </DashboardTableCard>
      </div>

      <!-- 创建 / 编辑 Key -->
      <UModal
        v-model:open="formOpen"
        :title="$t(isCreating ? 'user.apiKeys.createTitle' : 'user.apiKeys.editTitle')"
        :ui="adminModalUi({ content: 'sm:max-w-3xl' })"
      >
        <template #body>
          <ApiKeyFormFields
            v-model="formState"
            :scope-select-items="scopeSelectItems"
            :ip-line-errors="ipLineErrors"
            :error="formError"
            :show-count="isCreating"
            :editing="!isCreating"
            size="sm"
          />
        </template>

        <template #footer>
          <div class="flex justify-end gap-2 w-full">
            <UButton
              variant="outline"
              color="neutral"
              @click="() => { formOpen = false }"
            >
              {{ $t('common.actions.cancel') }}
            </UButton>
            <UButton
              :loading="submittingForm"
              :disabled="!!formError"
              @click="submitForm"
            >
              {{ $t(isCreating ? 'user.apiKeys.generate' : 'common.actions.save') }}
            </UButton>
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
