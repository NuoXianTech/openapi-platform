import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import { db, type DatabaseTransaction } from '~~/server/db/client'
import { apiProducts, apiRoutes, apiVersions } from '~~/server/db/schema'
import { createApplicationError } from '~~/server/errors/application-error'
import { routingReferenceService } from '~~/server/services/routing-reference-service'
import { applyPlatformMutation } from '~~/server/services/platform-endpoint-publication-service'
import { getSqlState } from '~~/server/utils/database-error'
import { firstRow } from '~~/server/utils/row'

interface UpdateProductInput {
  name?: string
  summary?: string
  description?: string
  categoryId?: number | null
  visibility?: 'public' | 'private'
  lifecycle?: 'active' | 'deprecated' | 'retired'
}

interface UpdateVersionInput {
  state?: 'draft' | 'published' | 'deprecated' | 'retired'
  changelog?: string
}

function lifecycleDates(state: NonNullable<UpdateVersionInput['state']>, now = new Date()) {
  return {
    publishedAt: ['published', 'deprecated', 'retired'].includes(state) ? now : null,
    deprecatedAt: ['deprecated', 'retired'].includes(state) ? now : null,
    retiredAt: state === 'retired' ? now : null
  }
}

function groupProducts(rows: Array<{
  product: typeof apiProducts.$inferSelect
  version: typeof apiVersions.$inferSelect | null
}>) {
  const result = new Map<string, typeof apiProducts.$inferSelect & {
    versions: Array<typeof apiVersions.$inferSelect>
  }>()
  for (const row of rows) {
    const item = result.get(row.product.id) ?? { ...row.product, versions: [] }
    if (row.version) item.versions.push(row.version)
    result.set(row.product.id, item)
  }
  return Array.from(result.values())
}

export const platformProductService = {
  async list() {
    const rows = await db.select({ product: apiProducts, version: apiVersions })
      .from(apiProducts)
      .leftJoin(apiVersions, eq(apiVersions.productId, apiProducts.id))
      .where(isNull(apiProducts.deletedAt))
      .orderBy(asc(apiProducts.name), asc(apiVersions.version))

    return groupProducts(rows)
  },

  async listPage(options: { limit: number, offset: number }) {
    const [products, totalRow] = await Promise.all([
      db.select().from(apiProducts)
        .where(isNull(apiProducts.deletedAt))
        .orderBy(asc(apiProducts.name), asc(apiProducts.id))
        .limit(options.limit)
        .offset(options.offset),
      db.select({ value: count() }).from(apiProducts)
        .where(isNull(apiProducts.deletedAt))
    ])
    const ids = products.map(product => product.id)
    const versions = ids.length === 0
      ? []
      : await db.select().from(apiVersions)
          .where(inArray(apiVersions.productId, ids))
          .orderBy(asc(apiVersions.version))
    const versionByProduct = new Map<string, typeof apiVersions.$inferSelect[]>()
    for (const version of versions) {
      const list = versionByProduct.get(version.productId) ?? []
      list.push(version)
      versionByProduct.set(version.productId, list)
    }
    return {
      items: products.map(product => ({
        ...product,
        versions: versionByProduct.get(product.id) ?? []
      })),
      total: Number(firstRow(totalRow)?.value ?? 0)
    }
  },

  async update(
    id: string,
    input: UpdateProductInput,
    options: { transaction?: DatabaseTransaction } = {}
  ) {
    const executor = options.transaction ?? db
    try {
      const updated = firstRow(await executor.update(apiProducts).set({
        name: input.name,
        summary: input.summary,
        description: input.description,
        categoryId: input.categoryId,
        visibility: input.visibility,
        lifecycle: input.lifecycle,
        updatedAt: new Date()
      }).where(and(eq(apiProducts.id, id), isNull(apiProducts.deletedAt))).returning())
      if (!updated) {
        throw createApplicationError({ statusCode: 404, message: 'product not found', data: { code: 'PRODUCT_NOT_FOUND' } })
      }
      return updated
    } catch (error) {
      if (getSqlState(error) === '23503') {
        throw createApplicationError({ statusCode: 404, message: 'category not found', data: { code: 'CATEGORY_NOT_FOUND' } })
      }
      throw error
    }
  },

  async remove(
    id: string,
    options: { transaction?: DatabaseTransaction } = {}
  ) {
    const executor = options.transaction ?? db
    if (await routingReferenceService.hasProduct(id, options.transaction)) {
      throw createApplicationError({
        statusCode: 409,
        message: 'product is still referenced by an active routing revision',
        data: { code: 'PRODUCT_STILL_PUBLISHED' }
      })
    }
    const routeCount = firstRow(await executor.select({ value: count() })
      .from(apiRoutes)
      .innerJoin(apiVersions, eq(apiVersions.id, apiRoutes.apiVersionId))
      .where(and(eq(apiVersions.productId, id), isNull(apiRoutes.deletedAt))))
    if (Number(routeCount?.value ?? 0) > 0) {
      throw createApplicationError({
        statusCode: 409,
        message: 'remove every route before deleting the product',
        data: { code: 'PRODUCT_HAS_ROUTES' }
      })
    }
    const now = new Date()
    const removed = firstRow(await executor.update(apiProducts).set({
      lifecycle: 'retired',
      deletedAt: now,
      updatedAt: now
    }).where(and(eq(apiProducts.id, id), isNull(apiProducts.deletedAt))).returning())
    if (!removed) {
      throw createApplicationError({ statusCode: 404, message: 'product not found', data: { code: 'PRODUCT_NOT_FOUND' } })
    }
    return removed
  },

  async updateVersion(
    id: string,
    input: UpdateVersionInput,
    options: { transaction?: DatabaseTransaction } = {}
  ) {
    const executor = options.transaction ?? db
    const current = firstRow(await executor.select({ version: apiVersions })
      .from(apiVersions)
      .innerJoin(apiProducts, eq(apiProducts.id, apiVersions.productId))
      .where(and(eq(apiVersions.id, id), isNull(apiProducts.deletedAt)))
      .limit(1))
    if (!current) {
      throw createApplicationError({ statusCode: 404, message: 'version not found', data: { code: 'VERSION_NOT_FOUND' } })
    }
    const timestampPatch = input.state
      ? lifecycleDates(input.state)
      : {}
    const version = firstRow(await executor.update(apiVersions).set({
      state: input.state,
      changelog: input.changelog,
      ...timestampPatch
    }).where(eq(apiVersions.id, id)).returning())
    if (!version) throw new Error('version update returned no row')
    return version
  },

  async removeVersion(
    id: string,
    options: { transaction?: DatabaseTransaction } = {}
  ) {
    const executor = options.transaction ?? db
    if (await routingReferenceService.hasVersion(id, options.transaction)) {
      throw createApplicationError({
        statusCode: 409,
        message: 'version is still referenced by an active routing revision',
        data: { code: 'VERSION_STILL_PUBLISHED' }
      })
    }
    const current = firstRow(await executor.select({ version: apiVersions })
      .from(apiVersions)
      .innerJoin(apiProducts, eq(apiProducts.id, apiVersions.productId))
      .where(eq(apiVersions.id, id)).limit(1))
    if (!current) {
      throw createApplicationError({ statusCode: 404, message: 'version not found', data: { code: 'VERSION_NOT_FOUND' } })
    }
    const routeCount = firstRow(await executor.select({ value: count() })
      .from(apiRoutes).where(and(
        eq(apiRoutes.apiVersionId, id),
        isNull(apiRoutes.deletedAt)
      )))
    if (Number(routeCount?.value ?? 0) > 0) {
      throw createApplicationError({
        statusCode: 409,
        message: 'version still owns routes',
        data: { code: 'VERSION_HAS_ROUTES' }
      })
    }
    await executor.delete(apiVersions).where(eq(apiVersions.id, id))
    return current.version
  },

  async findVersionProduct(
    apiVersionId: string,
    options: { transaction?: DatabaseTransaction } = {}
  ) {
    const executor = options.transaction ?? db
    return firstRow(await executor.select({
      version: apiVersions,
      product: apiProducts
    }).from(apiVersions)
      .innerJoin(apiProducts, and(eq(apiProducts.id, apiVersions.productId), isNull(apiProducts.deletedAt)))
      .where(eq(apiVersions.id, apiVersionId))
      .limit(1))
  },

  async updateAndPublish(
    id: string,
    input: UpdateProductInput,
    createdBy: number | null
  ) {
    const committed = await applyPlatformMutation(createdBy, async tx => ({
      value: await platformProductService.update(id, input, { transaction: tx })
    }))
    const { value: product, ...publication } = committed
    return { product, ...publication }
  },

  async removeAndPublish(id: string, createdBy: number | null) {
    const committed = await applyPlatformMutation(createdBy, async tx => ({
      value: await platformProductService.remove(id, { transaction: tx })
    }))
    const { value: product, ...publication } = committed
    return { product, ...publication }
  },

  async updateVersionAndPublish(
    id: string,
    input: UpdateVersionInput,
    createdBy: number | null
  ) {
    const committed = await applyPlatformMutation(createdBy, async tx => ({
      value: await platformProductService.updateVersion(id, input, { transaction: tx })
    }))
    const { value: version, ...publication } = committed
    return { version, ...publication }
  },

  async removeVersionAndPublish(id: string, createdBy: number | null) {
    const committed = await applyPlatformMutation(createdBy, async tx => ({
      value: await platformProductService.removeVersion(id, { transaction: tx })
    }))
    const { value: version, ...publication } = committed
    return { version, ...publication }
  }
}
