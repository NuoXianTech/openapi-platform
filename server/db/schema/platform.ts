import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import type { RoutingRevisionPayload } from '~~/server/types/routing-revision'
import type {
  RedactedServiceConfigurationState,
  ServiceConfigurationDefinition,
  ServiceDescription,
  StoredServiceConfigurationValues
} from '#shared/types/service-control'

export const apiCategories = pgTable('api_categories', {
  id: serial('id').primaryKey(),
  code: varchar('code', { length: 50 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  icon: varchar('icon', { length: 120 }),
  color: varchar('color', { length: 20 }),
  parentId: integer('parent_id').references((): AnyPgColumn => apiCategories.id, { onDelete: 'set null' }),
  sortOrder: integer('sort_order').notNull().default(0),
  isEnabled: boolean('is_enabled').notNull().default(true),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date())
}, table => [
  uniqueIndex('api_categories_code_uq')
    .on(table.code)
    .where(sql`${table.deletedAt} IS NULL`),
  index('api_categories_parent_sort_idx').on(table.parentId, table.sortOrder),
  index('api_categories_enabled_sort_idx').on(table.isEnabled, table.sortOrder)
])

export const openapiDocuments = pgTable('openapi_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  upstreamServiceId: uuid('upstream_service_id').references((): AnyPgColumn => upstreamServices.id, { onDelete: 'set null' }),
  sourceType: varchar('source_type', { length: 20 }).notNull(),
  sourceUrl: text('source_url'),
  format: varchar('format', { length: 10 }).notNull(),
  specVersion: varchar('spec_version', { length: 20 }).notNull(),
  content: jsonb('content').$type<Record<string, unknown>>().notNull(),
  contentHash: varchar('content_hash', { length: 64 }).notNull(),
  parsedSummary: jsonb('parsed_summary').$type<Record<string, unknown>>().notNull().default({}),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
}, table => [
  index('openapi_documents_created_idx').on(table.createdAt.desc()),
  uniqueIndex('openapi_documents_upstream_hash_uq')
    .on(table.upstreamServiceId, table.contentHash)
    .where(sql`${table.upstreamServiceId} IS NOT NULL`),
  check('openapi_documents_source_type_chk', sql`${table.sourceType} in ('upload', 'url')`),
  check('openapi_documents_format_chk', sql`${table.format} in ('json', 'yaml')`)
])

export const apiProducts = pgTable('api_products', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 80 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  summary: varchar('summary', { length: 300 }).notNull().default(''),
  description: text('description').notNull().default(''),
  categoryId: integer('category_id').references(() => apiCategories.id, { onDelete: 'set null' }),
  visibility: varchar('visibility', { length: 20 }).notNull().default('public'),
  lifecycle: varchar('lifecycle', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, table => [
  uniqueIndex('api_products_slug_uq')
    .on(table.slug)
    .where(sql`${table.deletedAt} IS NULL`),
  index('api_products_lifecycle_idx').on(table.lifecycle),
  index('api_products_category_idx').on(table.categoryId),
  check('api_products_visibility_chk', sql`${table.visibility} in ('public', 'private')`),
  check('api_products_lifecycle_chk', sql`${table.lifecycle} in ('active', 'deprecated', 'retired')`)
])

export const apiVersions = pgTable('api_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => apiProducts.id, { onDelete: 'cascade' }),
  version: varchar('version', { length: 80 }).notNull(),
  state: varchar('state', { length: 20 }).notNull().default('draft'),
  openapiDocumentId: uuid('openapi_document_id').references(() => openapiDocuments.id, { onDelete: 'set null' }),
  changelog: text('changelog').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true })
}, table => [
  uniqueIndex('api_versions_product_version_uq').on(table.productId, table.version),
  index('api_versions_product_state_idx').on(table.productId, table.state),
  check('api_versions_state_chk', sql`${table.state} in ('draft', 'published', 'deprecated', 'retired')`)
])

export const upstreamServices = pgTable('upstream_services', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 80 }).notNull(),
  name: varchar('name', { length: 160 }).notNull(),
  openapiDocumentId: uuid('openapi_document_id').references(() => openapiDocuments.id, { onDelete: 'set null' }),
  loadBalancing: varchar('load_balancing', { length: 30 }).notNull().default('round_robin'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, table => [
  uniqueIndex('upstream_services_slug_uq')
    .on(table.slug)
    .where(sql`${table.deletedAt} IS NULL`),
  index('upstream_services_status_idx').on(table.status),
  check('upstream_services_load_balancing_chk', sql`${table.loadBalancing} in ('round_robin', 'weighted')`),
  check('upstream_services_status_chk', sql`${table.status} in ('active', 'disabled')`)
])

export const upstreamTargets = pgTable('upstream_targets', {
  id: uuid('id').primaryKey().defaultRandom(),
  upstreamServiceId: uuid('upstream_service_id').notNull().references(() => upstreamServices.id, { onDelete: 'cascade' }),
  baseUrl: text('base_url').notNull(),
  weight: integer('weight').notNull().default(1),
  enabled: boolean('enabled').notNull().default(true),
  lastError: varchar('last_error', { length: 500 }),
  configurationRevision: integer('configuration_revision'),
  configurationHash: varchar('configuration_hash', { length: 64 }),
  configurationStatus: varchar('configuration_status', { length: 20 }).notNull().default('unknown'),
  configurationState: jsonb('configuration_state').$type<RedactedServiceConfigurationState>(),
  lastConfigurationSyncAt: timestamp('last_configuration_sync_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date())
}, table => [
  uniqueIndex('upstream_targets_service_url_uq').on(table.upstreamServiceId, table.baseUrl),
  index('upstream_targets_service_enabled_idx').on(table.upstreamServiceId, table.enabled),
  check('upstream_targets_weight_chk', sql`${table.weight} between 1 and 10000`),
  check('upstream_targets_configuration_revision_chk', sql`${table.configurationRevision} is null or ${table.configurationRevision} >= 0`),
  check('upstream_targets_configuration_status_chk', sql`${table.configurationStatus} in ('unknown', 'synced', 'drifted', 'error')`)
])

export const upstreamServiceConnections = pgTable('upstream_service_connections', {
  upstreamServiceId: uuid('upstream_service_id').primaryKey(),
  serviceTokenCiphertext: text('service_token_ciphertext').notNull(),
  // Token rotation is staged here until a discovery request verifies the new
  // credential.  Gateway traffic keeps using the active ciphertext while a
  // pending value is being checked.
  pendingServiceTokenCiphertext: text('pending_service_token_ciphertext'),
  serviceId: varchar('service_id', { length: 120 }),
  serviceName: varchar('service_name', { length: 160 }),
  serviceVersion: varchar('service_version', { length: 160 }),
  serviceCommit: varchar('service_commit', { length: 160 }),
  serviceProtocol: varchar('service_protocol', { length: 80 }),
  serviceDescription: jsonb('service_description').$type<ServiceDescription>(),
  openapiSha256: varchar('openapi_sha256', { length: 64 }),
  configurationSchemaSha256: varchar('configuration_schema_sha256', { length: 64 }),
  configurationSchema: jsonb('configuration_schema').$type<ServiceConfigurationDefinition>(),
  configurationValues: jsonb('configuration_values').$type<StoredServiceConfigurationValues>().notNull().default({ values: {}, secrets: {} }),
  configurationRevision: integer('configuration_revision').notNull().default(0),
  configurationHash: varchar('configuration_hash', { length: 64 }),
  lastDiscoveredAt: timestamp('last_discovered_at', { withTimezone: true }),
  lastConfigurationSyncAt: timestamp('last_configuration_sync_at', { withTimezone: true }),
  lastDiscoveryError: varchar('last_discovery_error', { length: 500 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date())
}, table => [
  foreignKey({
    name: 'upstream_service_connections_service_fk',
    columns: [table.upstreamServiceId],
    foreignColumns: [upstreamServices.id]
  }).onDelete('cascade'),
  check('upstream_service_connections_revision_chk', sql`${table.configurationRevision} >= 0`)
])

export const apiRoutes = pgTable('api_routes', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiVersionId: uuid('api_version_id').notNull().references(() => apiVersions.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 160 }).notNull(),
  hosts: jsonb('hosts').$type<string[]>().notNull().default([]),
  method: varchar('method', { length: 10 }).notNull(),
  pathPattern: varchar('path_pattern', { length: 1000 }).notNull(),
  normalizedShape: varchar('normalized_shape', { length: 1000 }).notNull(),
  upstreamServiceId: uuid('upstream_service_id').notNull(),
  upstreamPathTemplate: varchar('upstream_path_template', { length: 1000 }).notNull(),
  isApiKey: boolean('is_api_key').notNull().default(false),
  isStatistics: boolean('is_statistics').notNull().default(true),
  creditsCost: integer('credits_cost').notNull().default(0),
  rateLimitPerSecond: integer('rate_limit_per_second').notNull().default(0),
  rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(0),
  rateLimitPerHour: integer('rate_limit_per_hour').notNull().default(0),
  rateLimitPerDay: integer('rate_limit_per_day').notNull().default(0),
  timeoutMs: integer('timeout_ms').notNull().default(10000),
  maxRequestBytes: integer('max_request_bytes').notNull().default(1048576),
  maxResponseBytes: integer('max_response_bytes').notNull().default(10485760),
  catalogStatus: varchar('catalog_status', { length: 20 }).notNull().default('automatic'),
  sensitiveQueryParameters: jsonb('sensitive_query_parameters').$type<string[]>().notNull().default([]),
  isSupportRoute: boolean('is_support_route').notNull().default(false),
  state: varchar('state', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
}, table => [
  uniqueIndex('api_routes_version_method_shape_uq')
    .on(table.apiVersionId, table.method, table.normalizedShape)
    .where(sql`${table.deletedAt} IS NULL`),
  index('api_routes_version_state_idx').on(table.apiVersionId, table.state),
  index('api_routes_upstream_idx').on(table.upstreamServiceId),
  foreignKey({
    name: 'api_routes_service_connection_fk',
    columns: [table.upstreamServiceId],
    foreignColumns: [upstreamServiceConnections.upstreamServiceId]
  }).onDelete('restrict'),
  check('api_routes_method_chk', sql`${table.method} in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE')`),
  check('api_routes_credits_cost_chk', sql`${table.creditsCost} >= 0`),
  check('api_routes_rate_limits_chk', sql`${table.rateLimitPerSecond} >= 0 and ${table.rateLimitPerMinute} >= 0 and ${table.rateLimitPerHour} >= 0 and ${table.rateLimitPerDay} >= 0`),
  check('api_routes_paid_policy_chk', sql`${table.creditsCost} = 0 or (${table.isApiKey} = true and ${table.isStatistics} = true)`),
  check('api_routes_timeout_chk', sql`${table.timeoutMs} between 100 and 120000`),
  check('api_routes_request_bytes_chk', sql`${table.maxRequestBytes} between 0 and 1073741824`),
  check('api_routes_response_bytes_chk', sql`${table.maxResponseBytes} between 0 and 2147483647`),
  check('api_routes_catalog_status_chk', sql`${table.catalogStatus} in ('automatic', 'maintenance')`),
  check('api_routes_state_chk', sql`${table.state} in ('draft', 'active', 'disabled')`)
])

export const routingRevisions = pgTable('routing_revisions', {
  id: uuid('id').primaryKey(),
  sequence: integer('sequence').notNull(),
  configPayload: jsonb('config_payload').$type<RoutingRevisionPayload>().notNull(),
  checksum: varchar('checksum', { length: 64 }).notNull(),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp('published_at', { withTimezone: true }).notNull()
}, table => [
  uniqueIndex('routing_revisions_sequence_uq').on(table.sequence),
  index('routing_revisions_created_idx').on(table.createdAt.desc()),
  index('routing_revisions_checksum_idx').on(table.checksum),
  check('routing_revisions_sequence_chk', sql`${table.sequence} > 0`)
])

/**
 * 网关运行时的单行配置。id 恒为 1：平台只有一个运行时，
 * 发布历史与激活指针都挂在这里。
 */
export const platformRuntime = pgTable('platform_runtime', {
  id: integer('id').primaryKey().default(1),
  defaultDomain: varchar('default_domain', { length: 253 }),
  activeRevisionId: uuid('active_revision_id').references(() => routingRevisions.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date())
}, table => [
  check('platform_runtime_singleton_chk', sql`${table.id} = 1`)
])
