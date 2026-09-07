import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SITE_SETTINGS_DEFAULTS } from '#shared/config/site-defaults'
import {
  SYSTEM_SETTING_DEFINITIONS,
  SYSTEM_SETTING_NAMES
} from '~~/server/config/system-settings'
import * as schema from '~~/server/db/schema'

const testContext = vi.hoisted(() => ({
  database: null as unknown,
  deletedCacheKeys: [] as string[]
}))

vi.mock('~~/server/db/client', () => ({
  get db() {
    return testContext.database
  }
}))

vi.mock('~~/server/utils/stored-secret', () => ({
  getApiKeySecret: () => Buffer.alloc(32, 9)
}))

vi.mock('~~/server/utils/shared-cache', () => ({
  async getSharedCache<TValue>(options: { loader: () => Promise<TValue> }): Promise<TValue> {
    return options.loader()
  },
  async deleteSharedCache(keys: string[]): Promise<void> {
    testContext.deletedCacheKeys.push(...keys)
  }
}))

const { systemSettingsService } = await import('~~/server/services/system-settings-service')

let client: PGlite

beforeAll(async () => {
  client = new PGlite()
  await client.exec(`
    CREATE TABLE system_settings (
      setting_key varchar(150) PRIMARY KEY NOT NULL,
      value jsonb NOT NULL,
      is_secret boolean NOT NULL DEFAULT false,
      description varchar(500) NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  testContext.database = drizzle(client, { schema })
})

afterAll(async () => {
  await client.close()
})

describe('system settings database service', () => {
  it('materializes registered defaults and stores updates as typed JSONB', async () => {
    await client.query(
      `INSERT INTO system_settings (setting_key, value, description)
       VALUES ($1, $2::jsonb, $3), ($4, $5::jsonb, $6)`,
      [
        'internal.unregistered', JSON.stringify('private'), 'not registered',
        'turnstile.site_key', JSON.stringify(123), 'legacy numeric site key'
      ]
    )

    const settings = await systemSettingsService.getSettings()

    expect(settings).toEqual({ ...SITE_SETTINGS_DEFAULTS, turnstileSiteKey: '123' })
    expect(Object.keys(settings)).toHaveLength(SYSTEM_SETTING_NAMES.length)

    const registeredRows = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM system_settings
      WHERE setting_key <> 'internal.unregistered'
    `)
    expect(registeredRows.rows[0]?.count).toBe(SYSTEM_SETTING_NAMES.length)

    const storedTypes = await client.query<{ setting_key: string, value_type: string }>(`
      SELECT setting_key, jsonb_typeof(value) AS value_type
      FROM system_settings
      WHERE setting_key IN ('site.name', 'smtp.port', 'smtp.secure')
      ORDER BY setting_key
    `)
    expect(storedTypes.rows).toEqual([
      { setting_key: 'site.name', value_type: 'string' },
      { setting_key: 'smtp.port', value_type: 'number' },
      { setting_key: 'smtp.secure', value_type: 'boolean' }
    ])

    const updated = await systemSettingsService.update({
      siteName: 'Updated OpenAPI',
      policeBeian: '京公网安备00123456789012号',
      policeBeianCode: ' 00123456789012 ',
      registrationMode: 'invite',
      registrationInviteCode: 'site-invite-2026',
      smtpPort: 2525,
      smtpPass: 'smtp-plaintext-secret',
      turnstileSiteKey: 'turnstile-site-key',
      turnstileSecretKey: 'turnstile-secret-key',
      turnstileLoginEnabled: true,
      clientIpSource: 'x_forwarded_for',
      trustedProxyCidrs: '127.0.0.1, ::1/128',
      clientIpForwardedHops: 2
    })
    expect(updated).toMatchObject({
      siteName: 'Updated OpenAPI',
      policeBeianCode: '00123456789012',
      registrationMode: 'invite',
      registrationInviteCode: 'site-invite-2026',
      smtpPort: 2525,
      smtpPass: 'smtp-plaintext-secret',
      clientIpSource: 'x_forwarded_for',
      trustedProxyCidrs: '127.0.0.1/32\n::1/128',
      clientIpForwardedHops: 2
    })

    await client.query(
      `UPDATE system_settings SET value = $1::jsonb WHERE setting_key = 'site.name'`,
      [JSON.stringify('Updated by another process')]
    )
    const reloaded = await systemSettingsService.update({ smtpPort: 2526 })
    expect(reloaded).toMatchObject({
      siteName: 'Updated by another process',
      smtpPort: 2526
    })

    await expect(systemSettingsService.update({
      clientIpSource: 'cloudflare',
      trustedProxyCidrs: ''
    })).rejects.toMatchObject({ statusCode: 400 })

    const secretRows = await client.query<{ value: string, is_secret: boolean }>(`
      SELECT value, is_secret
      FROM system_settings
      WHERE setting_key = 'smtp.password'
    `)
    const storedSecret = secretRows.rows[0]
    expect(storedSecret?.is_secret).toBe(true)
    expect(storedSecret?.value).toMatch(/^enc:system-setting:v2:/)
    expect(storedSecret?.value).not.toContain('smtp-plaintext-secret')

    const inviteRows = await client.query<{ value: string, is_secret: boolean }>(`
      SELECT value, is_secret
      FROM system_settings
      WHERE setting_key = 'registration.invite_code'
    `)
    const storedInvite = inviteRows.rows[0]
    expect(storedInvite?.is_secret).toBe(true)
    expect(storedInvite?.value).toMatch(/^enc:system-setting:v2:/)
    expect(storedInvite?.value).not.toContain('site-invite-2026')

    const siteKeyRows = await client.query<{ value: string, is_secret: boolean }>(`
      SELECT value, is_secret
      FROM system_settings
      WHERE setting_key = 'turnstile.site_key'
    `)
    const storedSiteKey = siteKeyRows.rows[0]
    expect(storedSiteKey?.is_secret).toBe(false)
    expect(storedSiteKey?.value).toBe('turnstile-site-key')

    const turnstileSecretRows = await client.query<{ value: string, is_secret: boolean }>(`
      SELECT value, is_secret
      FROM system_settings
      WHERE setting_key = 'turnstile.secret_key'
    `)
    const storedTurnstileSecret = turnstileSecretRows.rows[0]
    expect(storedTurnstileSecret?.is_secret).toBe(true)
    expect(storedTurnstileSecret?.value).toMatch(/^enc:system-setting:v2:/)
    expect(storedTurnstileSecret?.value).not.toContain('turnstile-secret-key')

    const safeAdminSettings = await systemSettingsService.getForAdmin()
    expect('registrationInviteCode' in safeAdminSettings).toBe(false)
    expect(safeAdminSettings.secrets.hasRegistrationInviteCode).toBe(true)
    expect('smtpPass' in safeAdminSettings).toBe(false)
    expect(safeAdminSettings.secrets.hasSmtpPass).toBe(true)
    expect(safeAdminSettings.secrets.hasTurnstileSecretKey).toBe(true)
    expect(testContext.deletedCacheKeys).toContain('cache:public:settings')

    const publicSettings = await systemSettingsService.getPublicSettings()
    expect(publicSettings.siteName).toBe('Updated by another process')
    expect(publicSettings.policeBeian).toBe('京公网安备00123456789012号')
    expect(publicSettings.policeBeianCode).toBe('00123456789012')
    expect(publicSettings.turnstile).toMatchObject({
      enabled: true,
      siteKey: 'turnstile-site-key',
      login: true
    })
    expect('internal.unregistered' in publicSettings).toBe(false)
    await systemSettingsService.update({ policeBeianCode: '' })
    expect((await systemSettingsService.getPublicSettings()).policeBeianCode).toBeNull()

    expect(systemSettingsService.registeredKeys()).toEqual(
      SYSTEM_SETTING_NAMES.map(name => SYSTEM_SETTING_DEFINITIONS[name].key)
    )
  })
})
