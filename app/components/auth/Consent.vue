<script setup lang="ts">
// 登录 / 注册时的「同意条款」勾选框。仅当后台配置了服务条款或隐私政策链接时才会被父级渲染。
const modelValue = defineModel<boolean>({ default: false })
const { t } = useI18n()

const { settings } = useSiteSettings()
const termsUrl = computed(() => settings.value.termsUrl || '')
const privacyUrl = computed(() => settings.value.privacyUrl || '')
</script>

<template>
  <UCheckbox
    v-model="modelValue"
    size="md"
    :aria-label="t('auth.consent.ariaLabel')"
  >
    <template #label>
      <span>
        {{ $t('auth.consent.prefix') }}
        <ULink
          v-if="termsUrl"
          :to="termsUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="auth-inline-link font-medium hover:underline"
          @click.stop
        >
          {{ $t('auth.consent.terms') }}
        </ULink>
        <template v-if="termsUrl && privacyUrl">
          {{ $t('auth.consent.and') }}
        </template>
        <ULink
          v-if="privacyUrl"
          :to="privacyUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="auth-inline-link font-medium hover:underline"
          @click.stop
        >
          {{ $t('auth.consent.privacy') }}
        </ULink>
      </span>
    </template>
  </UCheckbox>
</template>
