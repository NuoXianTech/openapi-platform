<script setup lang="ts">
const props = defineProps<{
  password: string
}>()
const { t } = useI18n()

const requirements = computed(() => [
  { regex: /.{8,}/, text: t('auth.passwordStrength.requirements.length') },
  { regex: /\d/, text: t('auth.passwordStrength.requirements.number') },
  { regex: /[a-z]/, text: t('auth.passwordStrength.requirements.lowercase') },
  { regex: /[A-Z]/, text: t('auth.passwordStrength.requirements.uppercase') }
])

const strength = computed(() => requirements.value.map(req => ({
  met: req.regex.test(props.password),
  text: req.text
})))

const score = computed(() => strength.value.filter(req => req.met).length)

const color = computed<'neutral' | 'error' | 'warning' | 'success'>(() => {
  if (!props.password) return 'neutral'
  if (score.value <= 2) return 'error'
  if (score.value === 3) return 'warning'
  return 'success'
})

const text = computed(() => {
  if (!props.password) return ''
  if (score.value <= 2) return t('auth.passwordStrength.weak')
  if (score.value === 3) return t('auth.passwordStrength.medium')
  return t('auth.passwordStrength.strong')
})
</script>

<template>
  <Transition name="state-fade">
    <div
      v-if="password"
      class="auth-password-strength"
    >
      <UProgress
        :color="color"
        :model-value="score"
        :max="4"
        size="xs"
      />
      <p class="auth-password-strength__label">
        {{ $t('auth.passwordStrength.title') }}<span :class="`auth-password-strength__value auth-password-strength__value--${color}`">{{ text }}</span>
      </p>
    </div>
  </Transition>
</template>

<style scoped>
.auth-password-strength {
  margin-top: 8px;
}

.auth-password-strength__label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--ui-text-muted);
}

.auth-password-strength__value {
  font-weight: 500;
}

.auth-password-strength__value--success { color: var(--ui-success); }
.auth-password-strength__value--warning { color: var(--ui-warning); }
.auth-password-strength__value--error { color: var(--ui-error); }
.auth-password-strength__value--neutral { color: var(--ui-text-muted); }
</style>
