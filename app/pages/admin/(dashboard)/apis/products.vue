<script setup lang="ts">
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { usePrivatePagedList } from '~/composables/dashboard/use-private-paged-list'
import type { PlatformApiVersion, PlatformProduct } from '#shared/types/platform'
import { parseFetchError } from '~/utils/client-error'
import { formatPlatformDate, platformStatusColor } from '~/utils/platform-display'

const { t, locale } = useI18n()
const modalOpen = ref(false)
const editingProduct = ref<PlatformProduct | null>(null)
const versionModalOpen = ref(false)
const versionProduct = ref<PlatformProduct | null>(null)
const editingVersion = ref<PlatformApiVersion | null>(null)
const toast = useToast()
const confirm = useConfirmDialog()

useHead({ title: () => t('admin.apis.routing.sections.productsTitle') })

const resource = usePrivatePagedList<Record<string, never>, PlatformProduct>({
  path: '/api/admin/v1/products/paged',
  defaultFilters: {},
  defaultPageSize: PAGE_SIZE_OPTIONS[0]
})
const products = computed(() => resource.items.value)
const page = resource.page
const pageSize = resource.pageSize
const total = resource.total

const columns = computed<TableColumn<PlatformProduct>[]>(() => [
  { id: 'product', header: t('admin.apis.routing.columns.product') },
  { id: 'versions', header: t('admin.apis.routing.columns.versions') },
  { id: 'visibility', header: t('admin.apis.routing.columns.visibility') },
  { id: 'lifecycle', header: t('admin.apis.routing.columns.lifecycle') },
  { id: 'createdAt', header: t('admin.apis.routing.columns.createdAt') },
  { id: 'actions', header: '' }
])

function openEditProduct(product: PlatformProduct) {
  editingProduct.value = product
  modalOpen.value = true
}

function openVersion(product: PlatformProduct, version: PlatformApiVersion) {
  versionProduct.value = product
  editingVersion.value = version
  versionModalOpen.value = true
}

async function refreshProducts() {
  await resource.refresh()
  if (versionProduct.value) {
    versionProduct.value = products.value.find(item => item.id === versionProduct.value?.id) ?? null
  }
}

async function removeProduct(product: PlatformProduct) {
  await confirm({
    title: t('admin.apis.routing.deleteProduct.title', { name: product.name }),
    description: t('admin.apis.routing.deleteProduct.description'),
    confirmColor: 'error',
    onConfirm: async () => {
      try {
        await $fetch(
          `/api/admin/v1/products/${product.id}`,
          { method: 'DELETE' }
        )
        toast.add({ title: t('common.feedback.deleted'), color: 'success' })
        await refreshProducts()
      } catch (error: unknown) {
        toast.add({ title: parseFetchError(error, t('common.feedback.deleteFailed')), color: 'error' })
        throw error
      }
    }
  })
}

async function removeVersion(product: PlatformProduct, version: PlatformApiVersion) {
  await confirm({
    title: t('admin.apis.routing.deleteVersion.title', { version: version.version }),
    description: t('admin.apis.routing.deleteVersion.description'),
    confirmColor: 'error',
    onConfirm: async () => {
      try {
        await $fetch(
          `/api/admin/v1/versions/${version.id}`,
          { method: 'DELETE' }
        )
        toast.add({ title: t('common.feedback.deleted'), color: 'success' })
        await refreshProducts()
      } catch (error: unknown) {
        toast.add({ title: parseFetchError(error, t('common.feedback.deleteFailed')), color: 'error' })
        throw error
      }
    }
  })
}

function productItems(product: PlatformProduct): DropdownMenuItem[][] {
  return [[
    { label: t('common.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => openEditProduct(product) }
  ], [
    { label: t('common.actions.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeProduct(product) }
  ]]
}

function versionItems(product: PlatformProduct, version: PlatformApiVersion): DropdownMenuItem[][] {
  return [[
    { label: t('common.actions.edit'), icon: 'i-lucide-pencil', onSelect: () => openVersion(product, version) },
    { label: t('common.actions.delete'), icon: 'i-lucide-trash-2', color: 'error', onSelect: () => removeVersion(product, version) }
  ]]
}
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="resource.error.value"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="$t('common.feedback.loadFailed')"
      :description="parseFetchError(resource.error.value, $t('common.feedback.loadFailed'))"
    >
      <template #actions>
        <UButton
          color="error"
          variant="soft"
          size="xs"
          @click="resource.refresh"
        >
          {{ $t('common.actions.retry') }}
        </UButton>
      </template>
    </UAlert>

    <DashboardTableCard
      :title="$t('admin.apis.routing.sections.productsTitle')"
      :description="$t('admin.apis.routing.sections.productsDescription')"
      :total="total"
      icon="i-lucide-package-open"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="resource.loading.value"
          @click="resource.refresh"
        >
          {{ $t('common.actions.refresh') }}
        </UButton>
      </template>
      <DashboardDataTable
        v-model:page="page"
        v-model:page-size="pageSize"
        :data="products"
        :columns="columns"
        :loading="resource.loading.value"
        :total="total"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :fixed="false"
        :empty-title="$t('admin.apis.routing.empty.productsTitle')"
        :empty-description="$t('admin.apis.routing.empty.productsDescription')"
        empty-icon="i-lucide-package-plus"
      >
        <template #product-cell="{ row }">
          <div class="min-w-48">
            <p class="text-sm font-semibold text-highlighted">
              {{ row.original.name }}
            </p>
            <p class="font-mono text-xs text-muted">
              {{ row.original.slug }}
            </p>
          </div>
        </template>
        <template #versions-cell="{ row }">
          <div class="flex flex-wrap gap-1.5">
            <UDropdownMenu
              v-for="version in row.original.versions"
              :key="version.id"
              :items="versionItems(row.original, version)"
            >
              <UBadge
                :color="platformStatusColor(version.state)"
                variant="subtle"
                size="sm"
                class="cursor-pointer"
              >
                {{ version.version }}
              </UBadge>
              <span class="text-xs text-muted">
                {{ $t(`admin.apis.routing.versionStates.${version.state}`) }}
              </span>
            </UDropdownMenu>
          </div>
        </template>
        <template #visibility-cell="{ row }">
          {{ $t(`admin.apis.routing.visibility.${row.original.visibility}`) }}
        </template>
        <template #lifecycle-cell="{ row }">
          <UBadge :color="platformStatusColor(row.original.lifecycle)" variant="subtle">
            {{ $t(`admin.apis.routing.lifecycle.${row.original.lifecycle}`) }}
          </UBadge>
        </template>
        <template #createdAt-cell="{ row }">
          <span class="text-xs text-muted">
            {{ formatPlatformDate(row.original.createdAt, locale) }}
          </span>
        </template>
        <template #actions-cell="{ row }">
          <div class="text-right">
            <UDropdownMenu :items="productItems(row.original)" :content="{ align: 'end' }">
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                size="sm"
                :aria-label="$t('common.actions.more')"
              />
            </UDropdownMenu>
          </div>
        </template>
        <template #empty-actions>
          <UButton
            size="sm"
            icon="i-lucide-list"
            to="/admin/apis"
          >
            {{ $t('admin.apis.routing.catalog.actions.manageEndpoints') }}
          </UButton>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>

    <AdminPlatformProductModal
      v-if="editingProduct"
      v-model:open="modalOpen"
      :product="editingProduct"
      @saved="refreshProducts"
    />
    <AdminPlatformVersionModal
      v-if="versionProduct && editingVersion"
      v-model:open="versionModalOpen"
      :product="versionProduct"
      :version="editingVersion"
      @saved="refreshProducts"
    />
  </div>
</template>
