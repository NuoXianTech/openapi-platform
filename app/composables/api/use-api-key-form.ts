import { computed, reactive } from 'vue'
import { defaultCustomExpiry, expiryToFormInput, findCidrLineErrors, parseCidrLines, expiryToIso } from '~/utils/api-key'
import type { ApiKeyFormModel, ApiKeyItem, ApiKeyPayload } from '#shared/types/api'

/**
 * API Key 创建 / 编辑表单状态机（user 与 admin 共用）。
 *
 * 一份 reactive 模型 + 校验 + payload 构造，取代此前 create / edit 两套并行实现：
 *   - 创建：useApiKeyForm() → reset()
 *   - 编辑：useApiKeyForm() → loadFrom(row)
 * 过期时间的「预设 ⇄ datetime-local ⇄ ISO」互转、CIDR 行校验均下沉到 utils/api-key。
 */
export function useApiKeyForm() {
  const { t } = useI18n()
  const form = reactive<ApiKeyFormModel>({
    name: '',
    expiryPreset: 'never',
    expiresAtCustom: defaultCustomExpiry(),
    count: 1,
    unlimitedQuota: true,
    totalQuota: 1000,
    scopesMode: 'all',
    scopesSelected: [],
    ipWhitelistText: ''
  })

  function reset() {
    form.name = ''
    form.expiryPreset = 'never'
    form.expiresAtCustom = defaultCustomExpiry()
    form.count = 1
    form.unlimitedQuota = true
    form.totalQuota = 1000
    form.scopesMode = 'all'
    form.scopesSelected = []
    form.ipWhitelistText = ''
  }

  /** 编辑场景：把一条已有 Key 的配置灌入表单 */
  function loadFrom(key: ApiKeyItem) {
    const expiry = expiryToFormInput(key.expiresAt)
    form.name = key.name || ''
    form.expiryPreset = expiry.preset
    form.expiresAtCustom = expiry.custom
    form.count = 1
    form.unlimitedQuota = key.totalQuota === null || key.totalQuota === undefined
    form.totalQuota = key.totalQuota ?? 1000
    form.scopesMode = key.scopes && key.scopes.length > 0 ? 'pick' : 'all'
    form.scopesSelected = key.scopes ? [...key.scopes] : []
    form.ipWhitelistText = key.ipWhitelist ? key.ipWhitelist.join('\n') : ''
  }

  /** 当前为 all 模式且未选任何接口时，用全部 scope 作为切到 pick 的预选起点 */
  function preselectAllScopes(allScopes: string[]) {
    if (form.scopesMode === 'all' && form.scopesSelected.length === 0) {
      form.scopesSelected = [...allScopes]
    }
  }

  const ipLineErrors = computed(() => findCidrLineErrors(form.ipWhitelistText))

  const error = computed<string | null>(() => {
    if (form.expiryPreset === 'custom' && !form.expiresAtCustom) return t('common.apiKeys.validation.expiryRequired')
    if (!form.unlimitedQuota) {
      if (form.totalQuota === null || form.totalQuota === undefined || Number(form.totalQuota) < 0) {
        return t('common.apiKeys.validation.invalidQuota')
      }
    }
    if (form.scopesMode === 'pick' && form.scopesSelected.length === 0) {
      return t('common.apiKeys.validation.scopeRequired')
    }
    if (ipLineErrors.value.length > 0) {
      return t('common.apiKeys.validation.invalidIpLines', { lines: ipLineErrors.value.map(e => e.index).join(', ') })
    }
    return null
  })

  /** 构造提交载荷；创建时调用方再补 `count` */
  function buildPayload(): ApiKeyPayload {
    const ipList = parseCidrLines(form.ipWhitelistText)
    return {
      name: form.name.trim() || t('common.apiKeys.defaultName'),
      expiresAt: expiryToIso(form.expiryPreset, form.expiresAtCustom),
      totalQuota: form.unlimitedQuota ? null : Number(form.totalQuota),
      scopes: form.scopesMode === 'all' ? null : [...form.scopesSelected],
      ipWhitelist: ipList.length === 0 ? null : ipList
    }
  }

  return { form, reset, loadFrom, preselectAllScopes, ipLineErrors, error, buildPayload }
}
