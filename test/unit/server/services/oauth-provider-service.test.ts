import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'

const context = vi.hoisted(() => ({ database: null as unknown }))
vi.mock('~~/server/db/client', () => ({ get db() { return context.database } }))
vi.mock('~~/server/utils/stored-secret', () => ({ getApiKeySecret: () => Buffer.alloc(32, 9) }))
vi.mock('~~/server/utils/shared-cache', () => ({
  async deleteSharedCache() {},
  async getSharedCache(options: { loader: () => Promise<unknown> }) { return options.loader() }
}))
const { systemSettingsService } = await import('~~/server/services/system-settings-service')
const { oauthProviderService } = await import('~~/server/services/oauth-provider-service')
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
  context.database = drizzle(client, { schema })
})
beforeEach(async () => {
  await client.exec('TRUNCATE system_settings')
  await systemSettingsService.update({
    oauthGithubClientId: 'github-client', oauthGithubClientSecret: 'github-before', oauthGithubEnabled: true,
    oauthQqClientId: 'qq-client', oauthQqClientSecret: 'qq-before', oauthQqEnabled: true
  })
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => client.close())

const batch = () => ({
  oauthForceBinding: true,
  providers: [
    { provider: 'github' as const, clientId: ' github-client ', isEnabled: true },
    { provider: 'qq' as const, clientId: ' qq-client ', isEnabled: true }
  ]
})

describe('OAuth provider settings commits', () => {
  it.each(['single', 'batch'])('preserves an intervening secret rotation and returns committed values: %s', async mode => {
    const commit = systemSettingsService.update.bind(systemSettingsService)
    vi.spyOn(systemSettingsService, 'update').mockImplementationOnce(async (patch) => {
      // Another writer commits after provider processing, before this patch takes its lock.
      await commit({ oauthGithubClientSecret: 'github-rotated', oauthQqClientSecret: 'qq-rotated' })
      return commit(patch)
    })
    const rows = mode === 'single'
      ? [await oauthProviderService.update('github', { clientId: ' github-changed ' })]
      : await oauthProviderService.updateAll(batch())
    expect(rows[0]).toMatchObject({ provider: 'github', clientSecret: 'github-rotated', isEnabled: true })
    expect(rows[0]?.clientId).toBe(mode === 'single' ? 'github-changed' : 'github-client')
    if (mode === 'batch') expect(rows[1]).toMatchObject({ provider: 'qq', clientId: 'qq-client', clientSecret: 'qq-rotated' })
    expect(await systemSettingsService.getSettings()).toMatchObject({
      oauthGithubClientSecret: 'github-rotated', oauthQqClientSecret: 'qq-rotated'
    })
  })

  it('preserves omitted client ID and enabled state as well as the secret', async () => {
    const commit = systemSettingsService.update.bind(systemSettingsService)
    vi.spyOn(systemSettingsService, 'update').mockImplementationOnce(async (patch) => {
      await commit({ oauthGithubClientId: 'changed-elsewhere', oauthGithubEnabled: false })
      return commit(patch)
    })
    expect(await oauthProviderService.update('github', { clientSecret: 'replacement' })).toEqual({
      provider: 'github', clientId: 'changed-elsewhere', clientSecret: 'replacement', isEnabled: false
    })
  })

  it.each(['single', 'batch'])('validates enabling against the locked credentials after an intervening removal: %s', async mode => {
    const commit = systemSettingsService.update.bind(systemSettingsService)
    vi.spyOn(systemSettingsService, 'update').mockImplementationOnce(async (patch) => {
      await commit({ oauthGithubClientSecret: '', oauthGithubEnabled: false })
      return commit(patch)
    })
    const result = mode === 'single'
      ? oauthProviderService.update('github', { isEnabled: true })
      : oauthProviderService.updateAll(batch())
    await expect(result).rejects.toMatchObject({ statusCode: 400 })
    expect(await systemSettingsService.getSettings()).toMatchObject({
      oauthGithubClientSecret: '', oauthGithubEnabled: false, oauthForceBinding: false
    })
  })

  it.each(['github', 'qq'] as const)('allows explicit clearing only when disabled: %s', async provider => {
    await expect(oauthProviderService.update(provider, { clientSecret: '' })).rejects.toMatchObject({ statusCode: 400 })
    expect(await oauthProviderService.update(provider, { clientSecret: '', isEnabled: false }))
      .toMatchObject({ provider, clientSecret: '', isEnabled: false })
  })

  it('rejects incomplete batch credentials without partially saving policy or another provider', async () => {
    const input = batch()
    input.providers[1]!.clientId = ''
    await expect(oauthProviderService.updateAll(input)).rejects.toMatchObject({ statusCode: 400 })
    expect(await systemSettingsService.getSettings()).toMatchObject({
      oauthForceBinding: false, oauthGithubClientId: 'github-client', oauthQqClientId: 'qq-client'
    })
  })

  it('enforces OAuth credentials for direct settings writes too', async () => {
    await expect(systemSettingsService.update({ oauthQqClientId: '' })).rejects.toMatchObject({ statusCode: 400 })
  })
})
