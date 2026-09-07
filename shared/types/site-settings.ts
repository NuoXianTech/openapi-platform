import type { ClientIpSource } from './client-ip'

/** 全站系统配置的强类型应用视图。数据库使用命名空间 key + JSONB 分行存储。 */
export interface SystemSettings {
  siteUrl: string
  siteImg: string
  siteName: string
  siteDescription: string
  startTime: string
  registrationMode: 'open' | 'invite' | 'closed'
  registrationInviteCode: string
  defaultRegisterCredits: number
  registerEmailFilterMode: 'off' | 'whitelist' | 'blacklist'
  registerEmailFilterList: string
  sessionMaxAgeSeconds: number
  sessionAbsoluteMaxAgeSeconds: number
  sessionRememberMaxAgeSeconds: number
  emailVerifyExpiresInMinutes: number
  emailActivationEnabled: boolean
  passwordResetExpiresInMinutes: number
  passwordResetEnabled: boolean
  icpBeian: string
  policeBeian: string
  policeBeianCode: string
  termsUrl: string
  privacyUrl: string
  clientIpSource: ClientIpSource
  trustedProxyCidrs: string
  clientIpForwardedHops: number
  smtpHost: string
  smtpPort: number
  smtpSecure: boolean
  smtpUser: string
  smtpPass: string
  smtpFrom: string
  smtpFromName: string
  smtpReplyTo: string
  smtpPoolMaxAgeSeconds: number
  oauthForceBinding: boolean
  oauthGithubClientId: string
  oauthGithubClientSecret: string
  oauthGithubEnabled: boolean
  oauthQqClientId: string
  oauthQqClientSecret: string
  oauthQqEnabled: boolean
  turnstileSiteKey: string
  turnstileSecretKey: string
  turnstileLoginEnabled: boolean
  turnstileRegisterEnabled: boolean
  turnstilePasswordResetEnabled: boolean
  turnstileCheckinEnabled: boolean
  checkinEnabled: boolean
  checkinCooldownMode: 'hours' | 'fixed_time'
  checkinRefreshHours: number
  checkinFixedRefreshTime: string
  checkinMode: 'fixed' | 'range'
  checkinAmountFixed: number
  checkinAmountMin: number
  checkinAmountMax: number
}

export type SystemSettingsPatch = Partial<SystemSettings>

export interface PublicTurnstileSettings {
  enabled: boolean
  siteKey: string
  login: boolean
  register: boolean
  passwordReset: boolean
  checkin: boolean
}

/**
 * 站点公开设置类型（/api/settings/public 返回结构）。
 *
 * - server: systemSettingsService.toPublicSettings 返回此结构
 * - client: useSiteSettings() 读取此结构
 * 双端必须保持同源，避免新增字段时只改一边。
 */
export interface PublicSiteSettings {
  siteUrl: string
  siteImg: string
  siteName: string
  siteDescription: string
  startTime: string
  uptimeDays: number | null
  icpBeian: string | null
  policeBeian: string | null
  policeBeianCode: string | null
  termsUrl: string | null
  privacyUrl: string | null
  registrationMode: SystemSettings['registrationMode']
  passwordResetEnabled: boolean
  turnstile: PublicTurnstileSettings
}
