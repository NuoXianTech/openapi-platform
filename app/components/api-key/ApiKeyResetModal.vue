<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue'
import { parseFetchError } from '~/utils/client-error'
import type { ApiKeyItem, CreatedApiKeyItem } from '#shared/types/api'

const props = withDefaults(defineProps<{
  open?: boolean
  target: ApiKeyItem | null
  onReset: (id: number) => Promise<CreatedApiKeyItem | undefined>
}>(), { open: true })

const emit = defineEmits<{
  saved: []
  'update:open': [value: boolean]
}>()

const toast = useToast()
const { t } = useI18n()
const { copyText } = useCopyFeedback()
const loading = ref(false)
const result = ref<CreatedApiKeyItem | null>(null)
let generation = 0
let disposed = false
let closed = false

function invalidate() {
  generation += 1
  loading.value = false
  result.value = null
}

function updateOpen(open: boolean) {
  closed = !open
  if (!open) invalidate()
  emit('update:open', open)
}

watch(
  () => [props.open, props.target] as const,
  () => {
    closed = !props.open
    invalidate()
  },
  { flush: 'sync' }
)
onScopeDispose(() => { disposed = true; invalidate() })

async function confirmReset() {
  if (!props.target || !props.open || closed || disposed || loading.value || result.value) return
  const version = generation
  const isCurrent = () => !disposed && !closed && props.open && generation === version
  loading.value = true
  try {
    const next = await props.onReset(props.target.id)
    if (!isCurrent() || !next) return
    result.value = next
    emit('saved')
    toast.add({ title: t('common.apiKeys.reset.success'), color: 'success' })
  } catch (err) {
    if (isCurrent()) toast.add({ title: parseFetchError(err, t('common.apiKeys.reset.failed')), color: 'error' })
  } finally {
    if (isCurrent()) loading.value = false
  }
}

async function copy(text: string) {
  await copyText(text)
}
</script>

<template>
  <UModal
    :open="open"
    :title="result ? $t('common.apiKeys.reset.saveNewTitle') : $t('common.apiKeys.reset.confirmTitle')"
    :ui="{ content: 'sm:max-w-md' }"
    @update:open="updateOpen"
  >
    <template #body>
      <UAlert
        v-if="!result"
        color="warning"
        variant="subtle"
        :title="$t('common.apiKeys.reset.warningTitle')"
        :description="$t('common.apiKeys.reset.warningDescription', { name: props.target?.name || $t('common.apiKeys.defaultName') })"
        icon="i-mdi-alert-outline"
      />
      <code
        v-else
        class="block font-mono text-sm break-all p-3 rounded bg-elevated"
      >
        {{ result.apiKey }}
      </code>
    </template>

    <template #footer="{ close }">
      <div
        v-if="!result"
        class="flex justify-end gap-2 w-full"
      >
        <UButton
          variant="outline"
          color="neutral"
          @click="close"
        >
          {{ $t('common.actions.cancel') }}
        </UButton>
        <UButton
          color="warning"
          :loading="loading"
          @click="confirmReset"
        >
          {{ $t('common.apiKeys.reset.confirmAction') }}
        </UButton>
      </div>
      <div
        v-else
        class="flex justify-end gap-2 w-full"
      >
        <UButton
          variant="outline"
          color="neutral"
          icon="i-mdi-content-copy"
          @click="copy(result.apiKey)"
        >
          {{ $t('common.actions.copy') }}
        </UButton>
        <UButton @click="close">
          {{ $t('common.apiKeys.reset.savedAction') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
