import { SUPPORTED_OAUTH_PROVIDERS, type SupportedOauthProvider } from '#shared/types/oauth'
import type { SystemSettingsPatch } from '#shared/types/site-settings'
import { createApplicationError } from '~~/server/errors/application-error'
import { isSupportedOauthProvider, providerIndex } from '~~/server/utils/oauth-provider-id'
import { systemSettingsService } from '~~/server/services/system-settings-service'

export interface OauthProviderPatch {
  clientId?: string
  clientSecret?: string
  isEnabled?: boolean
}

interface OauthProviderBatchItem {
  provider: SupportedOauthProvider
  clientId: string
  clientSecret?: string
  isEnabled: boolean
}

export interface OauthProviderBatchUpdate {
  oauthForceBinding: boolean
  providers: OauthProviderBatchItem[]
}

// provider 配置视图。数据落在 system_settings 的命名空间键中，敏感值加密存储。
export interface OauthProviderRow {
  provider: SupportedOauthProvider
  clientId: string
  clientSecret: string
  isEnabled: boolean
}

interface AdminOauthProviderSafe {
  provider: SupportedOauthProvider
  clientId: string
  clientSecret: string
  isEnabled: boolean
}

type SystemSettingsSnapshot = Awaited<ReturnType<typeof systemSettingsService.getSettings>>

// provider → 强类型配置名映射，集中一处。扩 provider 时只需注册配置并在此声明映射。
interface ProviderColumns {
  clientId: 'oauthGithubClientId' | 'oauthQqClientId'
  clientSecret: 'oauthGithubClientSecret' | 'oauthQqClientSecret'
  isEnabled: 'oauthGithubEnabled' | 'oauthQqEnabled'
}
const PROVIDER_COLUMNS: Record<SupportedOauthProvider, ProviderColumns> = {
  github: { clientId: 'oauthGithubClientId', clientSecret: 'oauthGithubClientSecret', isEnabled: 'oauthGithubEnabled' },
  qq: { clientId: 'oauthQqClientId', clientSecret: 'oauthQqClientSecret', isEnabled: 'oauthQqEnabled' }
}

function rowFromSettings(settings: SystemSettingsSnapshot, provider: SupportedOauthProvider): OauthProviderRow {
  const cols = PROVIDER_COLUMNS[provider]
  return {
    provider,
    clientId: settings[cols.clientId],
    clientSecret: settings[cols.clientSecret],
    isEnabled: settings[cols.isEnabled]
  }
}

export function toAdminOauthProviderSafe(row: OauthProviderRow): AdminOauthProviderSafe {
  return {
    provider: row.provider,
    clientId: row.clientId,
    clientSecret: row.clientSecret ? '***' : '',
    isEnabled: row.isEnabled
  }
}

export function buildCallbackUrl(siteUrl: string, provider: string) {
  const base = siteUrl.replace(/\/+$/, '') || 'http://localhost:3000'
  if (!isSupportedOauthProvider(provider)) {
    // 仅支持白名单 provider；未识别时返回一个无效但显式的占位，
    // 调用方会在 oauthProviderService.update 等处校验并抛错，不会真把它发给第三方平台
    return `${base}/callback/openid/-1`
  }
  return `${base}/callback/openid/${providerIndex(provider)}`
}

export const oauthProviderService = {
  /** 列出全部受支持 provider 的配置（github / qq，固定两条），admin 列表用 */
  async list(): Promise<OauthProviderRow[]> {
    const settings = await systemSettingsService.getSettings()
    return SUPPORTED_OAUTH_PROVIDERS.map(p => rowFromSettings(settings, p))
  },

  /** 已启用的 provider（按各 provider 自己的启用开关；无全局总开关） */
  async listEnabledProviders(): Promise<SupportedOauthProvider[]> {
    const settings = await systemSettingsService.getSettings()
    return SUPPORTED_OAUTH_PROVIDERS.filter(p => settings[PROVIDER_COLUMNS[p].isEnabled])
  },

  async getByProvider(provider: string): Promise<OauthProviderRow | null> {
    if (!isSupportedOauthProvider(provider)) {
      return null
    }
    const settings = await systemSettingsService.getSettings()
    return rowFromSettings(settings, provider)
  },

  async update(provider: string, patch: OauthProviderPatch): Promise<OauthProviderRow> {
    if (!isSupportedOauthProvider(provider)) {
      throw createApplicationError({ statusCode: 400, message: 'provider not supported, only github and qq are allowed' })
    }
    const columns = PROVIDER_COLUMNS[provider]
    const input: SystemSettingsPatch = {}
    // 保留省略语义：只有持锁快照才能决定未提交字段的当前值。
    if (patch.clientId !== undefined) input[columns.clientId] = patch.clientId
    if (patch.clientSecret !== undefined) input[columns.clientSecret] = patch.clientSecret
    if (patch.isEnabled !== undefined) input[columns.isEnabled] = patch.isEnabled
    const persisted = await systemSettingsService.update(input)
    return rowFromSettings(persisted, provider)
  },

  /** 将绑定策略和全部 provider 配置作为一次数据库更新提交，避免部分保存成功。 */
  async updateAll(batch: OauthProviderBatchUpdate): Promise<OauthProviderRow[]> {
    const input: SystemSettingsPatch = { oauthForceBinding: batch.oauthForceBinding }

    for (const provider of SUPPORTED_OAUTH_PROVIDERS) {
      const submitted = batch.providers.find(item => item.provider === provider)
      if (!submitted) {
        throw createApplicationError({ statusCode: 400, message: `缺少 ${provider} 登录配置` })
      }

      const columns = PROVIDER_COLUMNS[provider]
      input[columns.clientId] = submitted.clientId
      if (submitted.clientSecret !== undefined) input[columns.clientSecret] = submitted.clientSecret
      input[columns.isEnabled] = submitted.isEnabled
    }

    const persisted = await systemSettingsService.update(input)
    return SUPPORTED_OAUTH_PROVIDERS.map(provider => rowFromSettings(persisted, provider))
  }
}
