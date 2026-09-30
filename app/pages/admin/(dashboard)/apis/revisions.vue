<script setup lang="ts">
import type { FormError, TableColumn } from '@nuxt/ui'
import { PAGE_SIZE_OPTIONS } from '~/constants/pagination'
import { useAdminRuntimeManagement } from '~/composables/admin/use-admin-runtime-management'
import type { PlatformRoutingRevisionSummary } from '#shared/types/platform'
import { parseFetchError } from '~/utils/client-error'
import { compactFormErrors } from '~/utils/form-validation'
import { formatPlatformDate } from '~/utils/platform-display'

const { t, locale } = useI18n()

useHead({ title: () => t('admin.apis.routing.sections.revisionsTitle') })

const hostPattern = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i

const {
  runtime, revisions, revisionsResource, revisionPage, revisionPageSize,
  loading, resourceError, domainState, domainDirty, controls,
  refresh, saveDomain, activateRevision
} = useAdminRuntimeManagement()

function validateDomain(value: Partial<typeof domainState>): FormError<string>[] {
  return compactFormErrors(
    value.defaultDomain && !hostPattern.test(value.defaultDomain.trim())
      ? { name: 'defaultDomain', message: t('admin.apis.routing.validation.hostInvalid') }
      : null
  )
}

const columns = computed<TableColumn<PlatformRoutingRevisionSummary>[]>(() => [
  { id: 'sequence', header: t('admin.apis.routing.columns.revision') },
  { id: 'routes', header: t('admin.apis.routing.columns.routeCount') },
  { id: 'checksum', header: t('admin.apis.routing.columns.checksum') },
  { id: 'publishedAt', header: t('admin.apis.routing.columns.publishedAt') },
  { id: 'status', header: t('admin.apis.routing.columns.state') },
  { id: 'actions', header: '' }
])
</script>

<template>
  <div class="space-y-6">
    <UAlert
      v-if="resourceError"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :title="$t('common.feedback.loadFailed')"
      :description="parseFetchError(resourceError, $t('common.feedback.loadFailed'))"
    >
      <template #actions>
        <UButton
          color="error"
          variant="soft"
          size="xs"
          :disabled="controls.refreshDisabled"
          @click="refresh"
        >
          {{ $t('common.actions.retry') }}
        </UButton>
      </template>
    </UAlert>

    <UCard variant="subtle" :ui="{ body: 'py-4 sm:py-4' }">
      <UForm
        :state="domainState"
        :validate="validateDomain"
        class="flex flex-col gap-4 lg:flex-row lg:items-end"
        @submit="saveDomain()"
      >
        <UFormField
          name="defaultDomain"
          class="flex-1"
          :label="$t('admin.apis.routing.fields.defaultDomain')"
          :description="$t('admin.apis.routing.runtime.defaultDomainHelp')"
        >
          <UInput
            v-model="domainState.defaultDomain"
            :placeholder="$t('admin.apis.routing.fallbackDomain')"
            class="w-full font-mono"
          />
        </UFormField>
        <UButton
          type="submit"
          :loading="controls.savingDomain"
          :disabled="!domainDirty || controls.disabled"
        >
          {{ $t('common.actions.save') }}
        </UButton>
      </UForm>
    </UCard>

    <DashboardTableCard
      :title="$t('admin.apis.routing.sections.revisionsTitle')"
      :description="$t('admin.apis.routing.sections.revisionsDescription')"
      :total="revisionsResource.total.value"
      icon="i-lucide-history"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="loading"
          :disabled="controls.refreshDisabled"
          @click="refresh"
        >
          {{ $t('common.actions.refresh') }}
        </UButton>
        <UButton to="/admin/apis" icon="i-lucide-waypoints">
          {{ $t('admin.apis.routing.catalog.actions.manageEndpoints') }}
        </UButton>
      </template>
      <DashboardDataTable
        v-model:page="revisionPage"
        v-model:page-size="revisionPageSize"
        :data="revisions"
        :columns="columns"
        :loading="revisionsResource.loading.value"
        :total="revisionsResource.total.value"
        :page-size-options="PAGE_SIZE_OPTIONS"
        :fixed="false"
        :empty-title="$t('admin.apis.routing.empty.revisionsTitle')"
        :empty-description="$t('admin.apis.routing.empty.revisionsDescription')"
        empty-icon="i-lucide-history"
      >
        <template #sequence-cell="{ row }">
          <div>
            <p class="font-mono text-sm font-semibold text-highlighted">
              #{{ row.original.sequence }}
            </p>
            <p class="mt-1 font-mono text-xs text-muted">
              {{ row.original.id }}
            </p>
          </div>
        </template>
        <template #routes-cell="{ row }">
          <span class="tabular-nums">{{ row.original.routeCount }}</span>
        </template>
        <template #checksum-cell="{ row }">
          <span class="font-mono text-xs text-muted">{{ row.original.checksum.slice(0, 12) }}</span>
        </template>
        <template #publishedAt-cell="{ row }">
          <span class="text-xs text-muted">
            {{ formatPlatformDate(row.original.publishedAt, locale) }}
          </span>
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.id === runtime.activeRevisionId ? 'success' : 'neutral'"
            variant="subtle"
          >
            {{ $t(row.original.id === runtime.activeRevisionId
              ? 'admin.apis.routing.revisionStatuses.active'
              : 'admin.apis.routing.revisionStatuses.historical') }}
          </UBadge>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UButton
              v-if="row.original.id !== runtime.activeRevisionId"
              color="warning"
              variant="ghost"
              size="xs"
              icon="i-lucide-rotate-ccw"
              :disabled="controls.disabled"
              @click="activateRevision(row.original)"
            >
              {{ $t('admin.apis.routing.actions.activateRevision') }}
            </UButton>
          </div>
        </template>
        <template #empty-actions>
          <UButton
            to="/admin/apis"
            size="sm"
            icon="i-lucide-waypoints"
          >
            {{ $t('admin.apis.routing.catalog.actions.manageEndpoints') }}
          </UButton>
        </template>
      </DashboardDataTable>
    </DashboardTableCard>
  </div>
</template>
