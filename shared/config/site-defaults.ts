import type { SystemSettings } from '../types/site-settings'

// Public site defaults shared by DB schema, service fallback, and frontend fallback.
export const PUBLIC_SITE_DEFAULTS = {
  siteUrl: 'http://localhost:3000',
  siteImg: '/favicon.ico',
  siteName: 'OpenAPI',
  siteDescription: 'OpenAPI是免费为用户提供网络数据接口调用的服务平台，我们致力于为用户提供稳定、快速的免费API数据接口服务。',
  startTime: '',
  passwordResetEnabled: true
} as const

export const SITE_SETTINGS_DEFAULTS = {
  ...PUBLIC_SITE_DEFAULTS,
  sessionMaxAgeSeconds: 60 * 60 * 24,
  sessionAbsoluteMaxAgeSeconds: 60 * 60 * 24 * 7,
  sessionRememberMaxAgeSeconds: 60 * 60 * 24 * 30,
  registrationMode: 'open', registrationInviteCode: '', defaultRegisterCredits: 0,
  registerEmailFilterMode: 'off', registerEmailFilterList: '',
  emailVerifyExpiresInMinutes: 30, emailActivationEnabled: true,
  passwordResetExpiresInMinutes: 30, smtpHost: 'smtp.example.com', smtpPort: 465,
  icpBeian: '', policeBeian: '', policeBeianCode: '', termsUrl: '', privacyUrl: '',
  clientIpSource: 'direct', trustedProxyCidrs: '', clientIpForwardedHops: 1,
  smtpSecure: true, smtpUser: '', smtpPass: '', smtpFrom: 'no-reply@example.com',
  smtpFromName: '', smtpReplyTo: '', smtpPoolMaxAgeSeconds: 0,
  oauthForceBinding: false, oauthGithubClientId: '', oauthGithubClientSecret: '', oauthGithubEnabled: false,
  oauthQqClientId: '', oauthQqClientSecret: '', oauthQqEnabled: false,
  turnstileSiteKey: '', turnstileSecretKey: '', turnstileLoginEnabled: false,
  turnstileRegisterEnabled: false, turnstilePasswordResetEnabled: false, turnstileCheckinEnabled: false,
  checkinEnabled: true, checkinCooldownMode: 'hours', checkinRefreshHours: 24,
  checkinFixedRefreshTime: '00:00', checkinMode: 'fixed', checkinAmountFixed: 10,
  checkinAmountMin: 5, checkinAmountMax: 20
} as const satisfies SystemSettings
