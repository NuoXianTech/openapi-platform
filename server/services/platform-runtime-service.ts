import { eq } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { platformRuntime } from '~~/server/db/schema'
import { normalizeRouteHost } from '~~/server/utils/route-pattern'
import { firstRow } from '~~/server/utils/row'
import { applyPlatformMutation } from '~~/server/services/routing-revision-service'

export const platformRuntimeService = {
  /** 平台只有一行运行时配置，启动时补齐即可。 */
  async ensureDefault() {
    await db.insert(platformRuntime).values({ id: 1 }).onConflictDoNothing()
    return platformRuntimeService.get()
  },

  async get() {
    const runtime = firstRow(await db.select().from(platformRuntime)
      .where(eq(platformRuntime.id, 1)).limit(1))
    if (!runtime) throw new Error('platform runtime bootstrap failed')
    return runtime
  },

  /**
   * 默认域名决定没有自带 Host 的 Route 在哪个域名上应答，改动会立即
   * 影响路由匹配，因此改完必须重新发布：发布过程会重新做一次冲突校验。
   */
  async updateDefaultDomain(defaultDomain: string | null, createdBy: number | null) {
    const committed = await applyPlatformMutation(createdBy, async (tx: DatabaseTransaction) => ({
      value: firstRow(await tx.update(platformRuntime).set({
        defaultDomain: defaultDomain ? normalizeRouteHost(defaultDomain) : null,
        updatedAt: new Date()
      }).where(eq(platformRuntime.id, 1)).returning())!
    }))
    return { runtime: committed.value, revision: committed.revision }
  }
}
