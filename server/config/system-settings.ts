import { z } from 'zod'
import { CLIENT_IP_SOURCES } from '#shared/types/client-ip'
import type { SystemSettings } from '#shared/types/site-settings'
import { SITE_SETTINGS_DEFAULTS } from '#shared/config/site-defaults'
import { parseTrustedProxyCidrs } from '#shared/utils/proxy-cidrs'
import {
  enumMessage,
  intRange,
  nonNegativeInt,
  positiveInt,
  requiredSiteOrigin,
  requiredString
} from '~~/server/schemas/validation'

interface SystemSettingDefinition<TValue> {
  key: string
  schema: z.ZodType<TValue>
  default: TValue
  public: boolean
  secret: boolean
  description: string
}

type SystemSettingDefinitionMap = {
  [TName in keyof SystemSettings]: SystemSettingDefinition<SystemSettings[TName]>
}

function text(max: number, trim = true) {
  const schema = trim ? z.string().trim() : z.string()
  return schema.max(max)
}

const optionalStartTimeSchema = z.string().trim().pipe(z.union([
  z.literal(''),
  z.iso.datetime({ local: true, precision: -1 })
], { error: '运行时间必须使用 YYYY-MM-DDTHH:mm 格式' }))

const trustedProxyCidrsSchema = z.string().max(10_000, '可信代理列表最多 10000 字符')
  .superRefine((value, ctx) => {
    const parsed = parseTrustedProxyCidrs(value)
    if (parsed.invalidEntries.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: `存在无效 IP 或 CIDR：${parsed.invalidEntries.slice(0, 5).join(', ')}`
      })
    }
    if (parsed.cidrs.length > 256) {
      ctx.addIssue({ code: 'custom', message: '可信代理最多配置 256 条' })
    }
  })
  .transform(value => parseTrustedProxyCidrs(value).normalized)

export const SYSTEM_SETTING_DEFINITIONS = {
  siteUrl: {
    key: 'site.url',
    schema: requiredSiteOrigin('站点 URL'),
    default: SITE_SETTINGS_DEFAULTS.siteUrl,
    public: true,
    secret: false,
    description: '站点对外访问地址'
  },
  siteImg: {
    key: 'site.image',
    schema: requiredString('站点图标', { max: 1000 }),
    default: SITE_SETTINGS_DEFAULTS.siteImg,
    public: true,
    secret: false,
    description: '站点图标地址'
  },
  siteName: {
    key: 'site.name',
    schema: requiredString('站点名称', { max: 140 }),
    default: SITE_SETTINGS_DEFAULTS.siteName,
    public: true,
    secret: false,
    description: '站点显示名称'
  },
  siteDescription: {
    key: 'site.description',
    schema: requiredString('站点描述', { max: 5000 }),
    default: SITE_SETTINGS_DEFAULTS.siteDescription,
    public: true,
    secret: false,
    description: '站点描述与 SEO 简介'
  },
  startTime: {
    key: 'site.start_time',
    schema: optionalStartTimeSchema,
    default: SITE_SETTINGS_DEFAULTS.startTime,
    public: true,
    secret: false,
    description: '站点开始运行时间'
  },
  registrationMode: {
    key: 'registration.mode',
    schema: z.enum(['open', 'invite', 'closed'], enumMessage('注册模式', ['open', 'invite', 'closed'])),
    default: SITE_SETTINGS_DEFAULTS.registrationMode,
    public: true,
    secret: false,
    description: '用户注册模式'
  },
  registrationInviteCode: {
    key: 'registration.invite_code',
    schema: z.string().trim().max(256, '邀请码最多 256 个字符').refine(
      value => value.length === 0 || value.length >= 8,
      '邀请码至少需要 8 个字符'
    ),
    default: SITE_SETTINGS_DEFAULTS.registrationInviteCode,
    public: false,
    secret: true,
    description: '邀请注册模式使用的站点邀请码'
  },
  defaultRegisterCredits: {
    key: 'registration.default_credits',
    schema: nonNegativeInt('默认注册积分'),
    default: SITE_SETTINGS_DEFAULTS.defaultRegisterCredits,
    public: false,
    secret: false,
    description: '新用户激活后获得的初始积分'
  },
  registerEmailFilterMode: {
    key: 'registration.email_filter.mode',
    schema: z.enum(['off', 'whitelist', 'blacklist'], enumMessage('邮箱过滤模式', ['off', 'whitelist', 'blacklist'])),
    default: SITE_SETTINGS_DEFAULTS.registerEmailFilterMode,
    public: false,
    secret: false,
    description: '注册邮箱域名过滤模式'
  },
  registerEmailFilterList: {
    key: 'registration.email_filter.list',
    schema: text(5000),
    default: SITE_SETTINGS_DEFAULTS.registerEmailFilterList,
    public: false,
    secret: false,
    description: '注册邮箱域名过滤列表'
  },
  sessionMaxAgeSeconds: {
    key: 'auth.session.max_age_seconds',
    schema: positiveInt('会话新鲜期'),
    default: SITE_SETTINGS_DEFAULTS.sessionMaxAgeSeconds,
    public: false,
    secret: false,
    description: '普通会话滑动有效期（秒）'
  },
  sessionAbsoluteMaxAgeSeconds: {
    key: 'auth.session.absolute_max_age_seconds',
    schema: positiveInt('会话绝对有效期'),
    default: SITE_SETTINGS_DEFAULTS.sessionAbsoluteMaxAgeSeconds,
    public: false,
    secret: false,
    description: '普通会话绝对有效期（秒）'
  },
  sessionRememberMaxAgeSeconds: {
    key: 'auth.session.remember_max_age_seconds',
    schema: positiveInt('记住登录有效期'),
    default: SITE_SETTINGS_DEFAULTS.sessionRememberMaxAgeSeconds,
    public: false,
    secret: false,
    description: '记住登录会话有效期（秒）'
  },
  emailVerifyExpiresInMinutes: {
    key: 'auth.email_verification.expires_minutes',
    schema: positiveInt('邮箱验证有效期'),
    default: SITE_SETTINGS_DEFAULTS.emailVerifyExpiresInMinutes,
    public: false,
    secret: false,
    description: '邮箱验证链接有效期（分钟）'
  },
  emailActivationEnabled: {
    key: 'auth.email_verification.enabled',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.emailActivationEnabled,
    public: false,
    secret: false,
    description: '注册后是否必须完成邮箱激活'
  },
  passwordResetExpiresInMinutes: {
    key: 'auth.password_reset.expires_minutes',
    schema: positiveInt('密码重置有效期'),
    default: SITE_SETTINGS_DEFAULTS.passwordResetExpiresInMinutes,
    public: false,
    secret: false,
    description: '密码重置链接有效期（分钟）'
  },
  passwordResetEnabled: {
    key: 'auth.password_reset.enabled',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.passwordResetEnabled,
    public: true,
    secret: false,
    description: '是否允许用户请求密码重置'
  },
  icpBeian: {
    key: 'legal.icp',
    schema: text(100),
    default: SITE_SETTINGS_DEFAULTS.icpBeian,
    public: true,
    secret: false,
    description: 'ICP 备案号'
  },
  policeBeian: {
    key: 'legal.police',
    schema: text(100),
    default: SITE_SETTINGS_DEFAULTS.policeBeian,
    public: true,
    secret: false,
    description: '公安备案号'
  },
  policeBeianCode: {
    key: 'legal.police_code',
    schema: text(100),
    default: SITE_SETTINGS_DEFAULTS.policeBeianCode,
    public: true,
    secret: false,
    description: '联网备案号码'
  },
  termsUrl: {
    key: 'legal.terms_url',
    schema: text(1000),
    default: SITE_SETTINGS_DEFAULTS.termsUrl,
    public: true,
    secret: false,
    description: '使用条款链接'
  },
  privacyUrl: {
    key: 'legal.privacy_url',
    schema: text(1000),
    default: SITE_SETTINGS_DEFAULTS.privacyUrl,
    public: true,
    secret: false,
    description: '隐私政策链接'
  },
  clientIpSource: {
    key: 'network.client_ip.source',
    schema: z.enum(CLIENT_IP_SOURCES, enumMessage('客户端 IP 来源', CLIENT_IP_SOURCES)),
    default: SITE_SETTINGS_DEFAULTS.clientIpSource,
    public: false,
    secret: false,
    description: '客户端 IP 的解析来源'
  },
  trustedProxyCidrs: {
    key: 'network.client_ip.trusted_proxy_cidrs',
    schema: trustedProxyCidrsSchema,
    default: SITE_SETTINGS_DEFAULTS.trustedProxyCidrs,
    public: false,
    secret: false,
    description: '允许提供客户端 IP 请求头的直连代理 IP 或 CIDR'
  },
  clientIpForwardedHops: {
    key: 'network.client_ip.forwarded_hops',
    schema: intRange('可信转发层数', 1, 10),
    default: SITE_SETTINGS_DEFAULTS.clientIpForwardedHops,
    public: false,
    secret: false,
    description: '从 X-Forwarded-For 右侧计算的可信代理层数'
  },
  smtpHost: {
    key: 'smtp.host',
    schema: requiredString('SMTP 主机', { max: 255 }),
    default: SITE_SETTINGS_DEFAULTS.smtpHost,
    public: false,
    secret: false,
    description: 'SMTP 服务器地址'
  },
  smtpPort: {
    key: 'smtp.port',
    schema: intRange('SMTP 端口', 1, 65535),
    default: SITE_SETTINGS_DEFAULTS.smtpPort,
    public: false,
    secret: false,
    description: 'SMTP 服务器端口'
  },
  smtpSecure: {
    key: 'smtp.secure',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.smtpSecure,
    public: false,
    secret: false,
    description: 'SMTP 是否使用 TLS'
  },
  smtpUser: {
    key: 'smtp.username',
    schema: text(255),
    default: SITE_SETTINGS_DEFAULTS.smtpUser,
    public: false,
    secret: false,
    description: 'SMTP 用户名'
  },
  smtpPass: {
    key: 'smtp.password',
    schema: z.string().max(2000),
    default: SITE_SETTINGS_DEFAULTS.smtpPass,
    public: false,
    secret: true,
    description: 'SMTP 密码'
  },
  smtpFrom: {
    key: 'smtp.from_address',
    schema: requiredString('发件邮箱', { max: 255 }),
    default: SITE_SETTINGS_DEFAULTS.smtpFrom,
    public: false,
    secret: false,
    description: 'SMTP 发件邮箱'
  },
  smtpFromName: {
    key: 'smtp.from_name',
    schema: text(255),
    default: SITE_SETTINGS_DEFAULTS.smtpFromName,
    public: false,
    secret: false,
    description: 'SMTP 发件人名称'
  },
  smtpReplyTo: {
    key: 'smtp.reply_to',
    schema: text(255),
    default: SITE_SETTINGS_DEFAULTS.smtpReplyTo,
    public: false,
    secret: false,
    description: 'SMTP 回复邮箱'
  },
  smtpPoolMaxAgeSeconds: {
    key: 'smtp.pool_max_age_seconds',
    schema: intRange('SMTP 连接池存活时间', 0, 86400),
    default: SITE_SETTINGS_DEFAULTS.smtpPoolMaxAgeSeconds,
    public: false,
    secret: false,
    description: 'SMTP 连接池最大复用时间（秒）'
  },
  oauthForceBinding: {
    key: 'oauth.force_binding',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.oauthForceBinding,
    public: false,
    secret: false,
    description: '第三方登录是否只允许绑定已有账号'
  },
  oauthGithubClientId: {
    key: 'oauth.github.client_id',
    schema: text(255),
    default: SITE_SETTINGS_DEFAULTS.oauthGithubClientId,
    public: false,
    secret: false,
    description: 'GitHub OAuth Client ID'
  },
  oauthGithubClientSecret: {
    key: 'oauth.github.client_secret',
    schema: z.string().max(2000),
    default: SITE_SETTINGS_DEFAULTS.oauthGithubClientSecret,
    public: false,
    secret: true,
    description: 'GitHub OAuth Client Secret'
  },
  oauthGithubEnabled: {
    key: 'oauth.github.enabled',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.oauthGithubEnabled,
    public: false,
    secret: false,
    description: '是否启用 GitHub OAuth'
  },
  oauthQqClientId: {
    key: 'oauth.qq.client_id',
    schema: text(255),
    default: SITE_SETTINGS_DEFAULTS.oauthQqClientId,
    public: false,
    secret: false,
    description: 'QQ OAuth Client ID'
  },
  oauthQqClientSecret: {
    key: 'oauth.qq.client_secret',
    schema: z.string().max(2000),
    default: SITE_SETTINGS_DEFAULTS.oauthQqClientSecret,
    public: false,
    secret: true,
    description: 'QQ OAuth Client Secret'
  },
  oauthQqEnabled: {
    key: 'oauth.qq.enabled',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.oauthQqEnabled,
    public: false,
    secret: false,
    description: '是否启用 QQ OAuth'
  },
  turnstileSiteKey: {
    key: 'turnstile.site_key',
    schema: text(200),
    default: SITE_SETTINGS_DEFAULTS.turnstileSiteKey,
    public: true,
    secret: false,
    description: 'Cloudflare Turnstile Site Key'
  },
  turnstileSecretKey: {
    key: 'turnstile.secret_key',
    schema: z.string().trim().max(2000),
    default: SITE_SETTINGS_DEFAULTS.turnstileSecretKey,
    public: false,
    secret: true,
    description: 'Cloudflare Turnstile Secret Key'
  },
  turnstileLoginEnabled: {
    key: 'turnstile.scenes.login',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.turnstileLoginEnabled,
    public: true,
    secret: false,
    description: '登录是否启用 Turnstile'
  },
  turnstileRegisterEnabled: {
    key: 'turnstile.scenes.register',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.turnstileRegisterEnabled,
    public: true,
    secret: false,
    description: '注册是否启用 Turnstile'
  },
  turnstilePasswordResetEnabled: {
    key: 'turnstile.scenes.password_reset',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.turnstilePasswordResetEnabled,
    public: true,
    secret: false,
    description: '密码重置是否启用 Turnstile'
  },
  turnstileCheckinEnabled: {
    key: 'turnstile.scenes.checkin',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.turnstileCheckinEnabled,
    public: true,
    secret: false,
    description: '每日签到是否启用 Turnstile'
  },
  checkinEnabled: {
    key: 'checkin.enabled',
    schema: z.boolean(),
    default: SITE_SETTINGS_DEFAULTS.checkinEnabled,
    public: false,
    secret: false,
    description: '是否启用每日签到'
  },
  checkinCooldownMode: {
    key: 'checkin.cooldown.mode',
    schema: z.enum(['hours', 'fixed_time'], enumMessage('签到冷却方式', ['hours', 'fixed_time'])),
    default: SITE_SETTINGS_DEFAULTS.checkinCooldownMode,
    public: false,
    secret: false,
    description: '每日签到刷新方式'
  },
  checkinRefreshHours: {
    key: 'checkin.cooldown.hours',
    schema: intRange('签到冷却间隔', 1, 24 * 30),
    default: SITE_SETTINGS_DEFAULTS.checkinRefreshHours,
    public: false,
    secret: false,
    description: '按小时刷新时的签到间隔'
  },
  checkinFixedRefreshTime: {
    key: 'checkin.cooldown.fixed_time',
    schema: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, '签到刷新时间必须为 HH:mm'),
    default: SITE_SETTINGS_DEFAULTS.checkinFixedRefreshTime,
    public: false,
    secret: false,
    description: '固定时间刷新时的每日刷新时间'
  },
  checkinMode: {
    key: 'checkin.reward.mode',
    schema: z.enum(['fixed', 'range'], enumMessage('签到奖励模式', ['fixed', 'range'])),
    default: SITE_SETTINGS_DEFAULTS.checkinMode,
    public: false,
    secret: false,
    description: '签到奖励计算方式'
  },
  checkinAmountFixed: {
    key: 'checkin.reward.fixed',
    schema: nonNegativeInt('固定签到积分'),
    default: SITE_SETTINGS_DEFAULTS.checkinAmountFixed,
    public: false,
    secret: false,
    description: '固定签到积分'
  },
  checkinAmountMin: {
    key: 'checkin.reward.min',
    schema: nonNegativeInt('最少签到积分'),
    default: SITE_SETTINGS_DEFAULTS.checkinAmountMin,
    public: false,
    secret: false,
    description: '随机签到积分下限'
  },
  checkinAmountMax: {
    key: 'checkin.reward.max',
    schema: nonNegativeInt('最多签到积分'),
    default: SITE_SETTINGS_DEFAULTS.checkinAmountMax,
    public: false,
    secret: false,
    description: '随机签到积分上限'
  }
} satisfies SystemSettingDefinitionMap

export type SystemSettingName = keyof typeof SYSTEM_SETTING_DEFINITIONS

export const SYSTEM_SETTING_NAMES = Object.freeze(
  Object.keys(SYSTEM_SETTING_DEFINITIONS) as SystemSettingName[]
)

export const OAUTH_SYSTEM_SETTING_NAMES = [
  'oauthForceBinding',
  'oauthGithubClientId',
  'oauthGithubClientSecret',
  'oauthGithubEnabled',
  'oauthQqClientId',
  'oauthQqClientSecret',
  'oauthQqEnabled'
] as const satisfies readonly SystemSettingName[]

const SYSTEM_SETTING_DEFINITION_BY_KEY = new Map(
  SYSTEM_SETTING_NAMES.map(name => [SYSTEM_SETTING_DEFINITIONS[name].key, { name, definition: SYSTEM_SETTING_DEFINITIONS[name] }])
)

if (SYSTEM_SETTING_DEFINITION_BY_KEY.size !== SYSTEM_SETTING_NAMES.length) {
  throw new Error('system setting database keys must be unique')
}

export function createSystemSettingsDefaults(): SystemSettings {
  return Object.fromEntries(
    SYSTEM_SETTING_NAMES.map(name => [name, SYSTEM_SETTING_DEFINITIONS[name].default])
  ) as unknown as SystemSettings
}

export function createSystemSettingsPatchShape<
  TName extends SystemSettingName = SystemSettingName
>(names: readonly TName[] = SYSTEM_SETTING_NAMES as readonly TName[]) {
  return Object.fromEntries(
    names.map(name => [name, SYSTEM_SETTING_DEFINITIONS[name].schema.optional()])
  ) as unknown as {
    [TKey in TName]: z.ZodOptional<z.ZodType<SystemSettings[TKey]>>
  }
}
