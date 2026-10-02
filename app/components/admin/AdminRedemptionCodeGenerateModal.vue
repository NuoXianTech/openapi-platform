<script setup lang="ts">
import type { GeneratePayload, GenerateResult } from '~/composables/admin/use-redemption-codes-page'
import { adminModalUi } from '~/utils/admin-modal-ui'
import { parseFetchError } from '~/utils/client-error'

const props = defineProps<{
  open: boolean
  onGenerate: (payload: GeneratePayload) => Promise<GenerateResult>
  onCopyOne: (code: string) => void
  onCopyAll: (codes: Array<{ code: string }>) => void
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const toast = useToast()
const { t } = useI18n()

const form = reactive({
  amount: 100,
  count: 1,
  maxUses: 1,
  /** `datetime-local` 字符串，空表示永不过期。 */
  expiresAt: '',
  note: ''
})

const generating = ref(false)
const result = ref<GenerateResult | null>(null)

function resetForm() {
  Object.assign(form, {
    amount: 100,
    count: 1,
    maxUses: 1,
    expiresAt: '',
    note: ''
  })
  result.value = null
}

watch(() => props.open, (v) => {
  if (v) resetForm()
})

async function submit() {
  if (!Number.isFinite(form.amount) || form.amount <= 0) {
    toast.add({ title: t('admin.credits.redemptionCodes.generate.validation.positiveAmount'), color: 'warning' })
    return
  }
  // Give immediate feedback; issuance also validates expiry before committing.
  const parsedExpiry = form.expiresAt ? new Date(form.expiresAt) : null
  if (parsedExpiry && (Number.isNaN(parsedExpiry.getTime()) || parsedExpiry.getTime() <= Date.now())) {
    toast.add({
      title: t('admin.credits.redemptionCodes.generate.validation.futureExpiry'),
      color: 'warning'
    })
    return
  }
  generating.value = true
  try {
    const expiresAt = parsedExpiry ? parsedExpiry.toISOString() : null
    result.value = await props.onGenerate({
      amount: Math.trunc(form.amount),
      count: Math.trunc(form.count),
      maxUses: Math.trunc(form.maxUses),
      expiresAt,
      note: form.note.trim() || null
    })
  } catch (err: unknown) {
    const code = (err as { data?: { data?: { code?: string } } } | null)?.data?.data?.code
    toast.add({
      title: code === 'REDEMPTION_EXPIRY_INVALID'
        ? t('admin.credits.redemptionCodes.generate.validation.futureExpiry')
        : parseFetchError(err, t('admin.credits.redemptionCodes.generate.failed')),
      color: 'error'
    })
  } finally {
    generating.value = false
  }
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    :title="$t('admin.credits.redemptionCodes.generate.title')"
    :dismissible="!generating"
    :ui="adminModalUi({ content: 'sm:max-w-2xl' })"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div
        v-if="!result"
        class="space-y-5"
      >
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="$t('admin.credits.redemptionCodes.generate.amount')">
            <UInput
              v-model.number="form.amount"
              type="number"
              min="1"
              :placeholder="$t('admin.credits.redemptionCodes.generate.amountPlaceholder')"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="$t('admin.credits.redemptionCodes.generate.count')">
            <UInput
              v-model.number="form.count"
              type="number"
              min="1"
              max="100"
              class="w-full"
            />
          </UFormField>
        </div>
        <!--
          `maxUses` carries a sentence-length explanation, so it uses `help`
          (rendered under the input) to keep both fields on the same baseline.
        -->
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            :label="$t('admin.credits.redemptionCodes.generate.maxUses')"
            :help="$t('admin.credits.redemptionCodes.generate.maxUsesHint')"
          >
            <UInput
              v-model.number="form.maxUses"
              type="number"
              min="1"
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="$t('admin.credits.redemptionCodes.columns.expiresAt')"
          >
            <!--
              An empty value means the code never expires, so the placeholder
              states that outcome rather than prompting for a date.
            -->
            <CommonDateTimePicker
              v-model="form.expiresAt"
              :placeholder="$t('admin.credits.redemptionCodes.neverExpires')"
            />
          </UFormField>
        </div>
        <UFormField :label="$t('admin.credits.redemptionCodes.generate.note')">
          <UInput
            v-model="form.note"
            :placeholder="$t('admin.credits.redemptionCodes.generate.notePlaceholder')"
            class="w-full"
          />
        </UFormField>
      </div>

      <div
        v-else
        class="space-y-4"
      >
        <UAlert
          :color="result.generated < result.requested ? 'warning' : 'success'"
          variant="subtle"
          :icon="result.generated < result.requested
            ? 'i-lucide-triangle-alert'
            : 'i-mdi-check-circle-outline'"
          :title="$t('admin.credits.redemptionCodes.generate.resultTitle', { count: result.generated })"
          :description="result.generated < result.requested
            ? $t('admin.credits.redemptionCodes.generate.partialResultDescription', {
              batchId: result.batchId,
              requested: result.requested,
              generated: result.generated
            })
            : $t('admin.credits.redemptionCodes.generate.resultDescription', { batchId: result.batchId })"
        />

        <div class="overflow-hidden rounded-lg border border-default">
          <div class="flex items-center gap-2 border-b border-default bg-elevated/30 px-3 py-2">
            <span class="text-xs font-medium text-muted">
              {{ $t('admin.credits.redemptionCodes.columns.code') }}
            </span>
            <UButton
              class="ms-auto"
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-mdi-content-copy"
              @click="onCopyAll(result.codes)"
            >
              {{ $t('admin.credits.redemptionCodes.actions.copyAll') }}
            </UButton>
          </div>
          <div class="max-h-72 divide-y divide-default overflow-auto">
            <div
              v-for="c in result.codes"
              :key="c.id"
              class="flex items-center gap-2 px-3 py-2"
            >
              <span class="min-w-0 flex-1 truncate font-mono text-sm text-highlighted">
                {{ c.code }}
              </span>
              <UButton
                class="shrink-0"
                size="xs"
                variant="ghost"
                color="neutral"
                square
                icon="i-mdi-content-copy"
                :aria-label="$t('admin.credits.redemptionCodes.actions.copyCode')"
                @click="onCopyOne(c.code)"
              />
            </div>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
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
          :loading="generating"
          @click="submit"
        >
          {{ $t('admin.credits.redemptionCodes.actions.generate') }}
        </UButton>
      </div>
      <div
        v-else
        class="flex justify-end gap-2 w-full"
      >
        <UButton
          variant="outline"
          color="neutral"
          @click="() => { result = null }"
        >
          {{ $t('admin.credits.redemptionCodes.actions.generateMore') }}
        </UButton>
        <UButton @click="close">
          {{ $t('admin.credits.redemptionCodes.actions.done') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
