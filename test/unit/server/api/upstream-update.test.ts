import type { H3Event } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminUpdateUpstreamSchema } from '~~/server/schemas/admin/platform'

const mocks = vi.hoisted(() => ({ body: {} as Record<string, unknown>, update: vi.fn(), log: vi.fn() }))
vi.mock('~~/server/utils/auth', () => ({ defineAdminEventHandler: (handler: (event: H3Event, admin: { id: number, username: string }) => Promise<unknown>) => (event: H3Event) => handler(event, { id: 1, username: 'admin' }) }))
vi.mock('~~/server/utils/router-param', () => ({ readUuidRouterParam: () => 'upstream-id' }))
vi.mock('~~/server/utils/zod', () => ({ readZodBody: async () => mocks.body }))
vi.mock('~~/server/services/platform-upstream-service', () => ({ platformUpstreamService: { updateAndPublish: mocks.update } }))
vi.mock('~~/server/utils/request-operation-log', () => ({ addRequestOperationLog: mocks.log }))
vi.mock('~~/server/utils/platform-view', () => ({ toPlatformUpstreamSummary: (value: unknown) => value }))
const { default: handler } = await import('~~/server/api/admin/v1/upstreams/[id].patch')

beforeEach(() => {
  vi.clearAllMocks()
  mocks.body = { name: 'Updated', serviceToken: 'synthetic-token-with-at-least-32-characters' }
  mocks.update.mockResolvedValue({ upstream: { id: 'upstream-id', name: 'Updated' }, revision: null })
})

describe('Upstream edit contract and audit', () => {
  it('accepts the combined edit while rejecting an invalid optional credential', () => {
    expect(adminUpdateUpstreamSchema.parse(mocks.body)).toEqual(mocks.body)
    expect(adminUpdateUpstreamSchema.safeParse({ name: 'Updated', serviceToken: 'short' }).success).toBe(false)
  })

  it('logs metadata and credential status without recording plaintext', async () => {
    await handler({} as H3Event)
    expect(mocks.update).toHaveBeenCalledWith('upstream-id', mocks.body, 1)
    expect(mocks.log.mock.calls.map(call => call[1])).toEqual([
      expect.objectContaining({ action: 'admin.platform.upstream.update', detail: { patch: { name: 'Updated' } } }),
      expect.objectContaining({ action: 'admin.platform.service.token.update', detail: { updated: true } })
    ])
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(mocks.body.serviceToken)
  })

  it('does not record a successful mutation when its transaction fails', async () => {
    mocks.update.mockRejectedValueOnce(new Error('rolled back'))
    await expect(handler({} as H3Event)).rejects.toThrow('rolled back')
    expect(mocks.log).not.toHaveBeenCalled()
  })
})
