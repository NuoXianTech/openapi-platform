import type {
  PublicSiteSettings,
  PublicTurnstileSettings,
  SystemSettings,
  SystemSettingsPatch
} from '#shared/types/site-settings'
import {
  SYSTEM_SETTING_DEFINITIONS,
  SYSTEM_SETTING_NAMES,
  createSystemSettingsDefaults,
  type SystemSettingName
} from '~~/server/config/system-settings'
import { db } from '~~/server/db/client'
import { systemSettings } from '~~/server/db/schema/system'
import { createApplicationError } from '~~/server/errors/application-error'
import { eq } from 'drizzle-orm'
import { deleteSharedCache, getSharedCache } from '~~/server/utils/shared-cache'
import {
  decodeSystemSettingSecret,
  encodeSystemSettingSecret
} from '~~/server/utils/system-setting-secret'

const PUBLIC_SYSTEM_SETTINGS_CACHE_KEY = 'cache:public:settings'
const PUBLIC_SYSTEM_SETTINGS_TTL_SECONDS = 30
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export type { PublicSiteSettings, PublicTurnstileSettings, SystemSettings, SystemSettingsPatch }

type SystemSettingRow = typeof systemSettings.$inferSelect
type SystemSettingInsert = typeof systemSettings.$inferInsert

const NON_SECRET_SETTING_NAMES = SYSTEM_SETTING_NAMES.filter(name => !SYSTEM_SETTING_DEFINITIONS[name].secret)

interface AdminSystemSettingsSecrets {
  hasRegistrationInviteCode: boolean
  hasSmtpPass: boolean
  hasOauthGithubClientSecret: boolean
  hasOauthQqClientSecret: boolean
  hasTurnstileSecretKey: boolean
}

export type AdminSystemSettings = Omit<
  SystemSettings,
  | 'registrationInviteCode'
  | 'smtpPass'
  | 'oauthGithubClientSecret'
  | 'oauthQqClientSecret'
  | 'turnstileSecretKey'
> & {
  secrets: AdminSystemSettingsSecrets
}

function encodeValue<TName extends SystemSettingName>(
  name: TName,
  input: SystemSettings[TName]
): unknown {
  const definition = SYSTEM_SETTING_DEFINITIONS[name]
  const value = definition.schema.parse(input)
  if (!definition.secret) return value
  if (typeof value !== 'string') {
    throw new Error(`secret system setting ${definition.key} must be a string`)
  }
  return encodeSystemSettingSecret(value)
}

function decodeValue<TName extends SystemSettingName>(
  name: TName,
  row: SystemSettingRow
): SystemSettings[TName] {
  const definition = SYSTEM_SETTING_DEFINITIONS[name]
  let value = row.value

  if (definition.secret) {
    if (!row.isSecret || typeof value !== 'string') {
      throw new Error(`系统敏感配置 ${definition.key} 的存储格式不正确`)
    }
    value = decodeSystemSettingSecret(value)
  } else if (row.isSecret) {
    throw new Error(`系统配置 ${definition.key} 的敏感标记与注册表不一致`)
  }

  let parsed = definition.schema.safeParse(value)
  // Older JSONB rows may contain a numeric/boolean scalar for a text setting.
  // Coerce only this lossless storage mismatch; request validation remains strict.
  if (!parsed.success && typeof definition.default === 'string'
    && (typeof value === 'number' || typeof value === 'boolean')) {
    parsed = definition.schema.safeParse(String(value))
  }
  if (!parsed.success) {
    throw new Error(`系统配置 ${definition.key} 的值不合法：${parsed.error.issues[0]?.message || 'unknown error'}`)
  }
  return parsed.data as SystemSettings[TName]
}

function createInsert<TName extends SystemSettingName>(
  name: TName,
  value: SystemSettings[TName]
): SystemSettingInsert {
  const definition = SYSTEM_SETTING_DEFINITIONS[name]
  return {
    settingKey: definition.key,
    value: encodeValue(name, value),
    isSecret: definition.secret,
    description: definition.description
  }
}

async function insertMissingDefaults(rows: SystemSettingInsert[]): Promise<void> {
  if (rows.length === 0) return
  await db.insert(systemSettings).values(rows).onConflictDoNothing()
}

async function loadSettingsFromDatabase(): Promise<SystemSettings> {
  const rows = await db.select().from(systemSettings)
  const rowsByKey = new Map(rows.map(row => [row.settingKey, row]))
  const values = createSystemSettingsDefaults()
  const missingRows: SystemSettingInsert[] = []
  for (const name of SYSTEM_SETTING_NAMES) {
    const definition = SYSTEM_SETTING_DEFINITIONS[name]
    const row = rowsByKey.get(definition.key)
    if (!row) {
      missingRows.push(createInsert(name, values[name]))
      continue
    }
    values[name] = decodeValue(name, row) as never
  }

  await insertMissingDefaults(missingRows)
  return values
}

function assertClientIpSettings(settings: SystemSettings): void {
  if (settings.clientIpSource === 'direct') return
  if (settings.trustedProxyCidrs.trim()) return

  throw createApplicationError({
    statusCode: 400,
    message: 'Cloudflare 或 X-Forwarded-For 模式必须至少配置一个可信代理 IP 或 CIDR'
  })
}

function updatesClientIpSettings(patch: SystemSettingsPatch): boolean {
  return patch.clientIpSource !== undefined
    || patch.trustedProxyCidrs !== undefined
    || patch.clientIpForwardedHops !== undefined
}

function toPublicTurnstile(settings: SystemSettings): PublicTurnstileSettings {
  const enabled = Boolean(settings.turnstileSiteKey) && Boolean(settings.turnstileSecretKey)
  return {
    enabled,
    siteKey: enabled ? settings.turnstileSiteKey : '',
    login: enabled && settings.turnstileLoginEnabled,
    register: enabled && settings.turnstileRegisterEnabled,
    passwordReset: enabled && settings.turnstilePasswordResetEnabled,
    checkin: enabled && settings.turnstileCheckinEnabled
  }
}

function calculateUptimeDays(startTime: string): number | null {
  if (!startTime) return null

  // startTime is validated as local ISO time; Node interprets it in the process TZ.
  const elapsed = Date.now() - new Date(startTime).getTime()
  return Number.isFinite(elapsed) && elapsed >= 0
    ? Math.floor(elapsed / MILLISECONDS_PER_DAY)
    : null
}

export function toAdminSystemSettings(settings: SystemSettings): AdminSystemSettings {
  const safe = Object.fromEntries(
    NON_SECRET_SETTING_NAMES.map(name => [name, settings[name]])
  ) as Omit<AdminSystemSettings, 'secrets'>

  return {
    ...safe,
    secrets: {
      hasRegistrationInviteCode: settings.registrationInviteCode.length > 0,
      hasSmtpPass: settings.smtpPass.length > 0,
      hasOauthGithubClientSecret: settings.oauthGithubClientSecret.length > 0,
      hasOauthQqClientSecret: settings.oauthQqClientSecret.length > 0,
      hasTurnstileSecretKey: settings.turnstileSecretKey.length > 0
    }
  }
}

function normalizePatch(input: SystemSettingsPatch): SystemSettingsPatch {
  const normalized: SystemSettingsPatch = {}
  for (const name of Object.keys(input) as SystemSettingName[]) {
    const value = input[name]
    if (value === undefined) continue
    normalized[name] = SYSTEM_SETTING_DEFINITIONS[name].schema.parse(value) as never
  }
  return normalized
}

function assertSettingsUpdate(next: SystemSettings, patch: SystemSettingsPatch): void {
  if (updatesClientIpSettings(patch)) assertClientIpSettings(next)
  if (next.registrationMode === 'invite' && !next.registrationInviteCode) {
    throw createApplicationError({
      statusCode: 400,
      message: '启用邀请注册前必须先配置邀请码'
    })
  }
  const turnstileSceneEnabled = next.turnstileLoginEnabled
    || next.turnstileRegisterEnabled
    || next.turnstilePasswordResetEnabled
    || next.turnstileCheckinEnabled
  if (turnstileSceneEnabled && (!next.turnstileSiteKey || !next.turnstileSecretKey)) {
    throw createApplicationError({
      statusCode: 400,
      message: '启用 Turnstile 场景前必须同时配置 Site Key 和 Secret Key'
    })
  }
}

export const systemSettingsService = {
  async getSettings(): Promise<SystemSettings> {
    return loadSettingsFromDatabase()
  },

  async get<TName extends SystemSettingName>(name: TName): Promise<SystemSettings[TName]> {
    return (await systemSettingsService.getSettings())[name]
  },

  async getPublicSettings(): Promise<PublicSiteSettings> {
    return getSharedCache<PublicSiteSettings>({
      key: PUBLIC_SYSTEM_SETTINGS_CACHE_KEY,
      ttlSeconds: PUBLIC_SYSTEM_SETTINGS_TTL_SECONDS,
      async loader() {
        return systemSettingsService.toPublicSettings(await systemSettingsService.getSettings())
      }
    })
  },

  toPublicSettings(settings: SystemSettings): PublicSiteSettings {
    return {
      siteUrl: settings.siteUrl,
      siteImg: settings.siteImg,
      siteName: settings.siteName,
      siteDescription: settings.siteDescription,
      startTime: settings.startTime,
      uptimeDays: calculateUptimeDays(settings.startTime),
      icpBeian: settings.icpBeian || null,
      policeBeian: settings.policeBeian || null,
      policeBeianCode: settings.policeBeianCode || null,
      termsUrl: settings.termsUrl || null,
      privacyUrl: settings.privacyUrl || null,
      registrationMode: settings.registrationMode,
      passwordResetEnabled: settings.passwordResetEnabled,
      turnstile: toPublicTurnstile(settings)
    }
  },

  async getForAdmin(): Promise<AdminSystemSettings> {
    return toAdminSystemSettings(await systemSettingsService.getSettings())
  },

  async update(input: SystemSettingsPatch): Promise<SystemSettings> {
    const normalizedPatch = normalizePatch(input)
    const persisted = await db.transaction(async (tx) => {
      // 配置更新很少发生，先幂等补齐注册表中的全部键，再锁定完整快照。
      // 这样多实例并发 patch 会在同一份最新配置上合并和执行跨字段校验。
      const defaults = createSystemSettingsDefaults()
      await tx.insert(systemSettings)
        .values(SYSTEM_SETTING_NAMES.map(name => createInsert(name, defaults[name] as never)))
        .onConflictDoNothing()

      const rows = await tx.select().from(systemSettings).for('update')
      const rowsByKey = new Map(rows.map(row => [row.settingKey, row]))
      const current = { ...defaults }
      for (const name of SYSTEM_SETTING_NAMES) {
        const row = rowsByKey.get(SYSTEM_SETTING_DEFINITIONS[name].key)
        if (row) current[name] = decodeValue(name, row) as never
      }

      const next = { ...current, ...normalizedPatch }
      assertSettingsUpdate(next, normalizedPatch)

      for (const name of Object.keys(normalizedPatch) as SystemSettingName[]) {
        const value = normalizedPatch[name]
        if (value === undefined) continue
        const row = createInsert(name, value as never)
        await tx.update(systemSettings).set({
          value: row.value,
          isSecret: row.isSecret,
          description: row.description,
          updatedAt: new Date()
        }).where(eq(systemSettings.settingKey, row.settingKey))
      }
      return next
    })
    await deleteSharedCache([PUBLIC_SYSTEM_SETTINGS_CACHE_KEY])
    return persisted
  },

  registeredKeys(): readonly string[] {
    return SYSTEM_SETTING_NAMES.map(name => SYSTEM_SETTING_DEFINITIONS[name].key)
  }
}
