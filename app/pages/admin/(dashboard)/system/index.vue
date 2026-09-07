<script setup lang="ts">
import type { AdminSettingsKey } from '~/composables/admin/use-admin-settings-page'
import { useAdminSettingsPage } from '~/composables/admin/use-admin-settings-page'

const { form, createSection } = useAdminSettingsPage()
const { t } = useI18n()

const basicInformationKeys = [
  'siteName',
  'siteDescription',
  'siteUrl',
  'siteImg',
  'startTime',
  'termsUrl',
  'privacyUrl',
  'icpBeian',
  'policeBeian',
  'policeBeianCode'
] as const satisfies readonly AdminSettingsKey[]

const checkinKeys = [
  'checkinEnabled',
  'checkinCooldownMode',
  'checkinRefreshHours',
  'checkinFixedRefreshTime',
  'checkinMode',
  'checkinAmountFixed',
  'checkinAmountMin',
  'checkinAmountMax'
] as const satisfies readonly AdminSettingsKey[]

const basicInformationSection = createSection(basicInformationKeys)
const checkinSection = createSection(checkinKeys)

const cooldownItems = computed(() => [
  { label: t('admin.system.site.checkin.cooldown.options.hours'), value: 'hours' },
  { label: t('admin.system.site.checkin.cooldown.options.fixedTime'), value: 'fixed_time' }
])

const modeItems = computed(() => [
  { label: t('admin.system.site.checkin.reward.options.fixed'), value: 'fixed' },
  { label: t('admin.system.site.checkin.reward.options.range'), value: 'range' }
])

// 区间随机时最小值不能大于最大值
const minMaxInvalid = computed(() => {
  if (form.checkinMode !== 'range') return false
  return form.checkinAmountMin > form.checkinAmountMax
})

// 固定时间刷新需符合 HH:mm
const fixedTimeInvalid = computed(() => {
  if (form.checkinCooldownMode !== 'fixed_time') return false
  return !/^([01]?\d|2[0-3]):[0-5]\d$/.test(form.checkinFixedRefreshTime || '')
})
</script>

<template>
  <div class="dashboard-settings-page">
    <DashboardSettingsSection
      :title="t('admin.system.site.basic.title')"
    >
      <UFormField
        name="siteName"
        :label="t('admin.system.site.basic.siteName.label')"
        :description="t('admin.system.site.basic.siteName.description')"
        required
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.siteName"
          autocomplete="off"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="siteDescription"
        :label="t('admin.system.site.basic.siteDescription.label')"
        :description="t('admin.system.site.basic.siteDescription.description')"
        required
        class="flex max-sm:flex-col justify-between items-start gap-4"
        :ui="{ container: 'w-full sm:max-w-lg' }"
      >
        <UTextarea
          v-model="form.siteDescription"
          :rows="5"
          autoresize
          class="w-full"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="siteUrl"
        :label="t('admin.system.site.basic.siteUrl.label')"
        :description="t('admin.system.site.basic.siteUrl.description')"
        required
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.siteUrl"
          placeholder="https://example.com"
          autocomplete="off"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="siteImg"
        :label="t('admin.system.site.basic.siteImage.label')"
        :description="t('admin.system.site.basic.siteImage.description')"
        required
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.siteImg"
          placeholder="/favicon.ico"
          autocomplete="off"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="startTime"
        :label="t('admin.system.site.basic.startTime.label')"
        :description="t('admin.system.site.basic.startTime.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <CommonDateTimePicker
          v-model="form.startTime"
          :placeholder="t('admin.system.site.basic.startTime.placeholder')"
          class="w-full sm:w-72"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="termsUrl"
        :label="t('admin.system.site.basic.termsUrl.label')"
        :description="t('admin.system.site.basic.termsUrl.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.termsUrl"
          placeholder="https://example.com/terms"
          autocomplete="off"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="privacyUrl"
        :label="t('admin.system.site.basic.privacyUrl.label')"
        :description="t('admin.system.site.basic.privacyUrl.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.privacyUrl"
          placeholder="https://example.com/privacy"
          autocomplete="off"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="icpBeian"
        :label="t('admin.system.site.basic.icpBeian.label')"
        :description="t('admin.system.site.basic.icpBeian.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.icpBeian"
          :placeholder="t('admin.system.site.basic.icpBeian.placeholder')"
          autocomplete="off"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="policeBeian"
        :label="t('admin.system.site.basic.policeBeian.label')"
        :description="t('admin.system.site.basic.policeBeian.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.policeBeian"
          :placeholder="t('admin.system.site.basic.policeBeian.placeholder')"
          autocomplete="off"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="policeBeianCode"
        :label="t('admin.system.site.basic.policeBeianCode.label')"
        :description="t('admin.system.site.basic.policeBeianCode.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.policeBeianCode"
          :placeholder="t('admin.system.site.basic.policeBeianCode.placeholder')"
          inputmode="numeric"
          :maxlength="100"
          autocomplete="off"
        />
      </UFormField>
      <template #footer>
        <AdminSettingsSectionActions
          :dirty="basicInformationSection.dirty.value"
          :saving="basicInformationSection.saving.value"
          :disabled="basicInformationSection.disabled.value"
          @save="basicInformationSection.save"
        />
      </template>
    </DashboardSettingsSection>

    <DashboardSettingsSection
      :title="t('admin.system.site.checkin.title')"
    >
      <UFormField
        name="checkinEnabled"
        :label="t('admin.system.site.checkin.enabled.label')"
        :description="t('admin.system.site.checkin.enabled.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <USwitch v-model="form.checkinEnabled" />
      </UFormField>
      <USeparator />
      <UFormField
        name="checkinCooldownMode"
        :label="t('admin.system.site.checkin.cooldown.label')"
        :description="t('admin.system.site.checkin.cooldown.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <USelect
          v-model="form.checkinCooldownMode"
          :items="cooldownItems"
          :disabled="!form.checkinEnabled"
          class="w-full sm:min-w-48"
        />
      </UFormField>
      <USeparator />
      <UFormField
        v-if="form.checkinCooldownMode === 'hours'"
        name="checkinRefreshHours"
        :label="t('admin.system.site.checkin.refreshHours.label')"
        :description="t('admin.system.site.checkin.refreshHours.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model.number="form.checkinRefreshHours"
          type="number"
          :min="1"
          :disabled="!form.checkinEnabled"
        />
      </UFormField>
      <UFormField
        v-else
        name="checkinFixedRefreshTime"
        :label="t('admin.system.site.checkin.fixedRefreshTime.label')"
        :description="t('admin.system.site.checkin.fixedRefreshTime.description')"
        :error="fixedTimeInvalid ? t('admin.system.site.checkin.validation.fixedTime') : undefined"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model="form.checkinFixedRefreshTime"
          type="time"
          :disabled="!form.checkinEnabled"
        />
      </UFormField>
      <USeparator />
      <UFormField
        name="checkinMode"
        :label="t('admin.system.site.checkin.reward.label')"
        :description="t('admin.system.site.checkin.reward.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <USelect
          v-model="form.checkinMode"
          :items="modeItems"
          :disabled="!form.checkinEnabled"
          class="w-full sm:min-w-48"
        />
      </UFormField>
      <USeparator />
      <UFormField
        v-if="form.checkinMode === 'fixed'"
        name="checkinAmountFixed"
        :label="t('admin.system.site.checkin.fixedAmount.label')"
        :description="t('admin.system.site.checkin.fixedAmount.description')"
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput
          v-model.number="form.checkinAmountFixed"
          type="number"
          :min="0"
          :disabled="!form.checkinEnabled"
        />
      </UFormField>
      <template v-else>
        <UFormField
          name="checkinAmountMin"
          :label="t('admin.system.site.checkin.minAmount.label')"
          :description="t('admin.system.site.checkin.minAmount.description')"
          :error="minMaxInvalid ? t('admin.system.site.checkin.validation.amountRange') : undefined"
          class="flex max-sm:flex-col justify-between items-start gap-4"
        >
          <UInput
            v-model.number="form.checkinAmountMin"
            type="number"
            :min="0"
            :disabled="!form.checkinEnabled"
          />
        </UFormField>
        <USeparator />
        <UFormField
          name="checkinAmountMax"
          :label="t('admin.system.site.checkin.maxAmount.label')"
          :description="t('admin.system.site.checkin.maxAmount.description')"
          class="flex max-sm:flex-col justify-between items-start gap-4"
        >
          <UInput
            v-model.number="form.checkinAmountMax"
            type="number"
            :min="0"
            :disabled="!form.checkinEnabled"
          />
        </UFormField>
      </template>
      <template #footer>
        <AdminSettingsSectionActions
          :dirty="checkinSection.dirty.value"
          :saving="checkinSection.saving.value"
          :disabled="checkinSection.disabled.value || minMaxInvalid || fixedTimeInvalid"
          @save="checkinSection.save"
        />
      </template>
    </DashboardSettingsSection>
  </div>
</template>
