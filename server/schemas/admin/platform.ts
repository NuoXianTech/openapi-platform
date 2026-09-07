import { z } from 'zod'
import {
  slugSchema,
  nameSchema,
  hostSchema,
  pathSchema,
  httpMethodSchema,
  targetBaseUrlSchema,
  targetWeightSchema,
  routeTimeoutSchema,
  routeRequestBytesSchema,
  routeResponseBytesSchema,
  routeCreditsCostSchema,
  routeRateLimitPerSecondSchema,
  routeRateLimitPerMinuteSchema,
  routeRateLimitPerHourSchema,
  routeRateLimitPerDaySchema,
  UPSTREAM_CONSTRAINTS,
  ROUTE_CONSTRAINTS,
  CONTENT_CONSTRAINTS
} from '#shared/schemas/platform-constraints'

export const adminUpdateRuntimeSchema = z.object({
  defaultDomain: hostSchema.nullable()
})

export const adminCreateProductSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  summary: z.string().trim().max(CONTENT_CONSTRAINTS.PRODUCT_SUMMARY_MAX_LENGTH).optional(),
  description: z.string().trim().max(CONTENT_CONSTRAINTS.PRODUCT_DESCRIPTION_MAX_LENGTH).optional(),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  visibility: z.enum(['public', 'private']).default('public'),
  version: z.string().trim().min(1).max(80).default('v1')
})

export const adminUpdateProductSchema = z.object({
  slug: slugSchema.optional(),
  name: nameSchema.optional(),
  summary: z.string().trim().max(CONTENT_CONSTRAINTS.PRODUCT_SUMMARY_MAX_LENGTH).optional(),
  description: z.string().trim().max(CONTENT_CONSTRAINTS.PRODUCT_DESCRIPTION_MAX_LENGTH).optional(),
  categoryId: z.coerce.number().int().positive().nullable().optional(),
  visibility: z.enum(['public', 'private']).optional(),
  lifecycle: z.enum(['active', 'deprecated', 'retired']).optional()
}).refine(value => Object.keys(value).length > 0, 'at least one field is required')

export const adminCreateVersionSchema = z.object({
  productId: z.uuid(),
  version: z.string().trim().min(1).max(80),
  state: z.enum(['draft', 'published', 'deprecated', 'retired']).default('draft'),
  changelog: z.string().trim().max(CONTENT_CONSTRAINTS.VERSION_CHANGELOG_MAX_LENGTH).default('')
})

export const adminUpdateVersionSchema = z.object({
  version: z.string().trim().min(1).max(80).optional(),
  state: z.enum(['draft', 'published', 'deprecated', 'retired']).optional(),
  changelog: z.string().trim().max(CONTENT_CONSTRAINTS.VERSION_CHANGELOG_MAX_LENGTH).optional()
}).refine(value => Object.keys(value).length > 0, 'at least one field is required')

export const adminCreateUpstreamSchema = z.object({
  slug: slugSchema,
  name: nameSchema,
  serviceToken: z.string().trim()
    .min(UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MIN_LENGTH)
    .max(UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MAX_LENGTH),
  loadBalancing: z.enum(['round_robin', 'weighted']).default('round_robin'),
  targets: z.array(z.object({
    baseUrl: targetBaseUrlSchema,
    weight: targetWeightSchema.default(1)
  })).min(1).max(UPSTREAM_CONSTRAINTS.TARGET_MAX_COUNT)
})

export const adminUpdateUpstreamSchema = z.object({
  slug: slugSchema.optional(),
  name: nameSchema.optional(),
  loadBalancing: z.enum(['round_robin', 'weighted']).optional(),
  status: z.enum(['active', 'disabled']).optional()
}).refine(value => Object.keys(value).length > 0, 'at least one field is required')

export const adminCreateTargetSchema = z.object({
  baseUrl: targetBaseUrlSchema,
  weight: targetWeightSchema.default(1),
  enabled: z.boolean().default(true)
})

export const adminUpdateTargetSchema = z.object({
  baseUrl: targetBaseUrlSchema.optional(),
  weight: targetWeightSchema.optional(),
  enabled: z.boolean().optional()
}).refine(value => Object.keys(value).length > 0, 'at least one field is required')

export const adminPublishServiceEndpointSchema = z.object({
  upstreamServiceId: z.uuid(),
  method: httpMethodSchema,
  path: pathSchema
})

export const adminUpdateEndpointPublicationSchema = z.object({
  enabled: z.boolean().optional(),
  name: nameSchema.optional(),
  isApiKey: z.boolean().optional(),
  isStatistics: z.boolean().optional(),
  creditsCost: routeCreditsCostSchema.optional(),
  rateLimitPerSecond: routeRateLimitPerSecondSchema.optional(),
  rateLimitPerMinute: routeRateLimitPerMinuteSchema.optional(),
  rateLimitPerHour: routeRateLimitPerHourSchema.optional(),
  rateLimitPerDay: routeRateLimitPerDaySchema.optional(),
  timeoutMs: routeTimeoutSchema.optional(),
  maxRequestBytes: routeRequestBytesSchema.optional(),
  maxResponseBytes: routeResponseBytesSchema.optional(),
  catalogStatus: z.enum(['automatic', 'maintenance']).optional(),
  sensitiveQueryParameters: z.array(
    z.string().trim().min(1).max(ROUTE_CONSTRAINTS.SENSITIVE_PARAM_MAX_LENGTH)
  ).max(ROUTE_CONSTRAINTS.SENSITIVE_PARAMS_MAX_COUNT).optional()
}).refine(value => Object.keys(value).length > 0, 'at least one field is required')

export const adminActivateRevisionSchema = z.object({
  revisionId: z.uuid()
})

export const adminUpdateServiceConfigurationSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  values: z.record(z.string(), z.unknown()).default({}),
  secrets: z.record(
    z.string(),
    z.string().max(100_000).nullable()
  ).default({})
})

export const adminUpdateServiceTokenSchema = z.object({
  serviceToken: z.string().trim()
    .min(UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MIN_LENGTH)
    .max(UPSTREAM_CONSTRAINTS.SERVICE_TOKEN_MAX_LENGTH)
})
