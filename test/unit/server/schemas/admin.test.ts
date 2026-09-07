import { describe, expect, it } from 'vitest'
import {
  adminAdjustCreditsSchema,
  adminCreateApiCategorySchema,
  adminCreateAnnouncementSchema,
  adminCreateFriendLinkSchema,
  adminCreateUpstreamSchema,
  adminUpdateEndpointPublicationSchema,
  adminUpdateProductSchema,
  adminUpdateVersionSchema,
  adminCleanupApiCallLogsSchema,
  adminCleanupLoginLogsSchema,
  adminCleanupOperationLogsSchema,
  adminDeleteRedemptionCodeSchema,
  adminInitialProfileSchema,
  adminToggleRedemptionCodeSchema,
  adminUpdateAnnouncementSchema,
  adminUpdateFriendLinkSchema,
  adminUpdateSiteSettingsSchema,
  adminUpdateUserSchema
} from '~~/server/schemas/admin'

describe('admin schemas', () => {
  it('allows group metadata edits while rejecting changes to generated identifiers', () => {
    expect(adminUpdateProductSchema.parse({
      name: ' Weather ', summary: 'Forecasts', description: 'Weather endpoints',
      categoryId: 1, visibility: 'private', lifecycle: 'deprecated'
    })).toEqual({
      name: 'Weather', summary: 'Forecasts', description: 'Weather endpoints',
      categoryId: 1, visibility: 'private', lifecycle: 'deprecated'
    })
    expect(adminUpdateProductSchema.safeParse({ slug: 'renamed' }).success).toBe(false)
    expect(adminUpdateProductSchema.safeParse({ name: 'Weather', slug: 'renamed' }).success).toBe(false)
    expect(adminUpdateProductSchema.safeParse({ name: 'Weather', version: 'v2' }).success).toBe(false)
    expect(adminUpdateProductSchema.safeParse({}).success).toBe(false)
  })

  it('allows version governance without changing its number or group', () => {
    expect(adminUpdateVersionSchema.parse({ state: 'deprecated', changelog: ' Updated ' }))
      .toEqual({ state: 'deprecated', changelog: 'Updated' })
    expect(adminUpdateVersionSchema.safeParse({ version: 'v2' }).success).toBe(false)
    expect(adminUpdateVersionSchema.safeParse({ state: 'published', version: 'v2' }).success).toBe(false)
    expect(adminUpdateVersionSchema.safeParse({ state: 'published', productId: crypto.randomUUID() }).success).toBe(false)
    expect(adminUpdateVersionSchema.safeParse({}).success).toBe(false)
  })

  it('requires a Service Token to create an upstream', () => {
    const input = {
      slug: 'service',
      name: 'Service',
      targets: [{ baseUrl: 'http://127.0.0.1:8080' }]
    }
    for (const serviceToken of [undefined, '', ' '.repeat(32), 'a'.repeat(31), 'a'.repeat(4097)]) {
      expect(adminCreateUpstreamSchema.safeParse({ ...input, serviceToken }).success).toBe(false)
    }
    expect(adminCreateUpstreamSchema.parse({ ...input, serviceToken: ` ${'a'.repeat(32)} ` }).serviceToken)
      .toBe('a'.repeat(32))
  })

  it('accepts endpoint governance without accepting contract mutations', () => {
    const contract = { method: 'POST', pathPattern: '/v1/other', upstreamServiceId: crypto.randomUUID() }
    expect(adminUpdateEndpointPublicationSchema.safeParse(contract).success).toBe(false)
    expect(adminUpdateEndpointPublicationSchema.parse({ ...contract, enabled: false }))
      .toEqual({ enabled: false })
  })

  it('rejects unsafe admin mutations and requires explicit credit targets', () => {
    expect(adminUpdateUserSchema.safeParse({
      id: 1,
      username: 'bad name',
      email: 'not-an-email'
    }).success).toBe(false)

    expect(adminUpdateUserSchema.safeParse({
      id: 1,
      username: 'new-name',
      email: 'valid@example.com'
    }).success).toBe(false)

    expect(adminUpdateUserSchema.safeParse({ id: 1 }).success).toBe(false)

    expect(adminAdjustCreditsSchema.safeParse({
      userIds: [],
      operation: 'grant',
      amount: 1
    }).success).toBe(false)

    expect(adminAdjustCreditsSchema.safeParse({
      userIds: [1, 2],
      operation: 'grant',
      amount: 1
    }).success).toBe(true)
  })

  it('requires initial admin password while accepting default or custom username and email', () => {
    expect(adminInitialProfileSchema.safeParse({
      username: 'admin',
      email: 'admin@openapi.com'
    }).success).toBe(false)

    expect(adminInitialProfileSchema.safeParse({
      username: 'admin',
      email: 'admin@openapi.com',
      password: 'new-admin-password'
    }).success).toBe(true)

    expect(adminInitialProfileSchema.safeParse({
      username: 'owner',
      email: 'owner@example.com',
      password: 'new-admin-password'
    }).success).toBe(true)
  })

  it('validates general settings without accepting OAuth-owned fields', () => {
    expect(adminUpdateSiteSettingsSchema.safeParse({
      siteName: 'OpenAPI Platform',
      checkinMode: 'range',
      checkinAmountMin: 5,
      checkinAmountMax: 20
    }).success).toBe(true)

    const turnstile = adminUpdateSiteSettingsSchema.safeParse({
      turnstileSiteKey: '  1x00000000000000000000AA  ',
      turnstileSecretKey: '  1x0000000000000000000000000000000AA  '
    })
    expect(turnstile.success).toBe(true)
    if (turnstile.success) {
      expect(turnstile.data.turnstileSiteKey).toBe('1x00000000000000000000AA')
      expect(turnstile.data.turnstileSecretKey).toBe('1x0000000000000000000000000000000AA')
    }
    expect(adminUpdateSiteSettingsSchema.safeParse({ turnstileSiteKey: 123 }).success).toBe(false)

    expect(adminUpdateSiteSettingsSchema.safeParse({
      oauthGithubEnabled: true
    }).success).toBe(false)

    expect(adminUpdateSiteSettingsSchema.safeParse({
      oauthForceBinding: true
    }).success).toBe(false)

    expect(adminUpdateSiteSettingsSchema.safeParse({
      unknownSetting: true
    }).success).toBe(false)

    expect(adminUpdateSiteSettingsSchema.safeParse({
      checkinMode: 'range',
      checkinAmountMin: 20,
      checkinAmountMax: 5
    }).success).toBe(false)
  })

  it('keeps content mutations within required database constraints', () => {
    expect(adminCreateApiCategorySchema.safeParse({
      code: 'x'.repeat(51),
      name: 'Category'
    }).success).toBe(false)
    expect(adminCreateAnnouncementSchema.safeParse({
      title: 'x'.repeat(201),
      content: 'Content'
    }).success).toBe(false)
    expect(adminCreateFriendLinkSchema.safeParse({
      title: 'x'.repeat(141),
      url: 'https://example.com'
    }).success).toBe(false)

    expect(adminUpdateAnnouncementSchema.safeParse({ id: 1, title: '   ' }).success).toBe(false)
    expect(adminUpdateAnnouncementSchema.safeParse({ id: 1, content: '' }).success).toBe(false)
    expect(adminUpdateFriendLinkSchema.safeParse({ id: 1, title: '   ' }).success).toBe(false)
  })

  it('requires explicit all-log confirmation when cleanup has no filters', () => {
    for (const schema of [
      adminCleanupApiCallLogsSchema,
      adminCleanupLoginLogsSchema,
      adminCleanupOperationLogsSchema
    ]) {
      expect(schema.safeParse({ confirm: true }).success).toBe(false)
      expect(schema.safeParse({ confirm: true, deleteAll: true }).success).toBe(true)
    }

    expect(adminCleanupLoginLogsSchema.safeParse({
      confirm: true,
      startAt: '2026-02-01T00:00:00Z',
      endAt: '2026-01-01T00:00:00Z'
    }).success).toBe(false)
    expect(adminCleanupApiCallLogsSchema.safeParse({
      confirm: true,
      types: ['error']
    }).success).toBe(true)
    expect(adminCleanupApiCallLogsSchema.safeParse({
      confirm: true,
      types: ['consume', 'error']
    }).success).toBe(false)
    expect(adminCleanupLoginLogsSchema.safeParse({
      confirm: true,
      deleteAll: true,
      success: false
    }).success).toBe(false)
    expect(adminCleanupLoginLogsSchema.safeParse({
      confirm: true,
      startAt: null
    }).success).toBe(false)
    expect(adminCleanupOperationLogsSchema.safeParse({
      confirm: true,
      userId: true
    }).success).toBe(false)
  })

  it('forces redemption code operations to address either one code or one batch', () => {
    for (const schema of [
      adminToggleRedemptionCodeSchema,
      adminDeleteRedemptionCodeSchema
    ]) {
      expect(schema.safeParse({ id: 7 }).success).toBe(true)
      expect(schema.safeParse({ batchId: 'batch-1' }).success).toBe(true)
      expect(schema.safeParse({}).success).toBe(false)
      // Accepting both would leave the request's meaning up to the order the
      // handler happens to read the fields in.
      expect(schema.safeParse({ id: 7, batchId: 'batch-1' }).success).toBe(false)
      // A blank batchId must not pass as "addressed"; it selects nothing.
      expect(schema.safeParse({ batchId: '   ' }).success).toBe(false)
    }
  })
})
