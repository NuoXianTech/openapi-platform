CREATE TABLE "credit_transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" varchar(50) NOT NULL,
	"route_id" uuid,
	"api_call_id" bigint,
	"credit_reservation_id" bigint,
	"code_id" integer,
	"operator_id" integer,
	"operator_name" varchar(140),
	"ip" varchar(45),
	"remark" varchar(500),
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redemption_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code_digest" varchar(64) NOT NULL,
	"code_ciphertext" varchar(512) NOT NULL,
	"code_preview" varchar(32) NOT NULL,
	"amount" integer NOT NULL,
	"batch_id" varchar(64),
	"note" varchar(500),
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemption_codes_code_digest_unique" UNIQUE("code_digest"),
	CONSTRAINT "redemption_codes_amount_chk" CHECK ("redemption_codes"."amount" > 0),
	CONSTRAINT "redemption_codes_max_uses_chk" CHECK ("redemption_codes"."max_uses" > 0),
	CONSTRAINT "redemption_codes_used_count_chk" CHECK ("redemption_codes"."used_count" >= 0 and "redemption_codes"."used_count" <= "redemption_codes"."max_uses")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"username" varchar(50) NOT NULL,
	"display_name" varchar(100),
	"email" varchar(255) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"locale" varchar(16),
	"credits" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_banned" boolean DEFAULT false NOT NULL,
	"banned_reason" varchar(500),
	"banned_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(45),
	"last_login_user_agent" varchar(500),
	"last_checkin_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"token_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_role_chk" CHECK ("users"."role" in ('user', 'admin')),
	CONSTRAINT "users_credits_chk" CHECK ("users"."credits" >= 0),
	CONSTRAINT "users_token_version_chk" CHECK ("users"."token_version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "oauth_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"provider" varchar(32) NOT NULL,
	"provider_user_id" varchar(255) NOT NULL,
	"nickname" varchar(140),
	"avatar_url" varchar(1000),
	"email" varchar(255),
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	"last_login_ip" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_call_stats" (
	"route_id" uuid NOT NULL,
	"stat_date" date NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_call_stats_route_id_stat_date_pk" PRIMARY KEY("route_id","stat_date"),
	CONSTRAINT "api_call_stats_counts_chk" CHECK ("api_call_stats"."total_count" >= 0 and "api_call_stats"."success_count" >= 0 and "api_call_stats"."failure_count" >= 0 and "api_call_stats"."success_count" + "api_call_stats"."failure_count" = "api_call_stats"."total_count")
);
--> statement-breakpoint
CREATE TABLE "api_calls" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"route_id" uuid NOT NULL,
	"route_name" varchar(160),
	"upstream_target_id" uuid,
	"upstream_target_url" text,
	"api_key_id" integer,
	"api_key_name" varchar(100),
	"user_id" integer,
	"path" varchar(1000) NOT NULL,
	"method" varchar(10) NOT NULL,
	"query_string" varchar(2000),
	"status_code" integer NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"ip" varchar(45),
	"user_agent" varchar(500),
	"referer" varchar(1000),
	"request_size" integer,
	"response_size" integer,
	"error_code" varchar(50),
	"error_message" varchar(500),
	"credits_cost" integer DEFAULT 0 NOT NULL,
	"is_counted" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_calls_status_code_chk" CHECK ("api_calls"."status_code" between 100 and 599),
	CONSTRAINT "api_calls_latency_ms_chk" CHECK ("api_calls"."latency_ms" >= 0),
	CONSTRAINT "api_calls_request_size_chk" CHECK ("api_calls"."request_size" is null or "api_calls"."request_size" >= 0),
	CONSTRAINT "api_calls_response_size_chk" CHECK ("api_calls"."response_size" is null or "api_calls"."response_size" >= 0),
	CONSTRAINT "api_calls_credits_cost_chk" CHECK ("api_calls"."credits_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "api_credit_reservations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"api_key_id" integer NOT NULL,
	"route_id" uuid NOT NULL,
	"api_call_id" bigint,
	"request_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(500),
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_credit_reservations_amount_chk" CHECK ("api_credit_reservations"."amount" > 0),
	CONSTRAINT "api_credit_reservations_status_chk" CHECK ("api_credit_reservations"."status" in ('active', 'pending', 'dead_letter')),
	CONSTRAINT "api_credit_reservations_attempts_chk" CHECK ("api_credit_reservations"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_digest" varchar(64) NOT NULL,
	"key_ciphertext" text NOT NULL,
	"key_preview" varchar(32) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"scopes" jsonb,
	"ip_whitelist" jsonb,
	"total_quota" integer,
	"used_credits" integer DEFAULT 0 NOT NULL,
	"total_calls" integer DEFAULT 0 NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_ip" varchar(45),
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_digest_unique" UNIQUE("key_digest"),
	CONSTRAINT "api_keys_total_quota_chk" CHECK ("api_keys"."total_quota" is null or "api_keys"."total_quota" >= 0),
	CONSTRAINT "api_keys_used_credits_chk" CHECK ("api_keys"."used_credits" >= 0),
	CONSTRAINT "api_keys_total_calls_chk" CHECK ("api_keys"."total_calls" >= 0)
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"level" varchar(20) DEFAULT 'info' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"link_url" varchar(1000),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" integer,
	"updated_by" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_level_chk" CHECK ("announcements"."level" in ('info', 'success', 'warning', 'critical'))
);
--> statement-breakpoint
CREATE TABLE "friend_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(140) NOT NULL,
	"url" varchar(1000) NOT NULL,
	"description" text,
	"logo_url" varchar(1000),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"recipient_user_id" integer NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_read_state_chk" CHECK ((
    "notification_deliveries"."is_read" = true and "notification_deliveries"."read_at" is not null
  ) or (
    "notification_deliveries"."is_read" = false and "notification_deliveries"."read_at" is null
  ))
);
--> statement-breakpoint
CREATE TABLE "notification_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"content" text NOT NULL,
	"level" varchar(20) DEFAULT 'info' NOT NULL,
	"link_url" varchar(1000),
	"audience" varchar(20) DEFAULT 'specific' NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"recipient_cutoff_user_id" integer,
	"sender_user_id" integer,
	"sender_actor" varchar(140),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_messages_level_chk" CHECK ("notification_messages"."level" in ('info', 'success', 'warning', 'critical')),
	CONSTRAINT "notification_messages_audience_chk" CHECK ("notification_messages"."audience" in ('specific', 'all_current', 'all_with_future')),
	CONSTRAINT "notification_messages_recipient_count_chk" CHECK ("notification_messages"."recipient_count" >= 0),
	CONSTRAINT "notification_messages_recipient_cutoff_chk" CHECK ((
    "notification_messages"."audience" = 'all_current' and "notification_messages"."recipient_cutoff_user_id" >= 0
  ) or (
    "notification_messages"."audience" <> 'all_current' and "notification_messages"."recipient_cutoff_user_id" is null
  ))
);
--> statement-breakpoint
CREATE TABLE "operation_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"actor" varchar(140),
	"action" varchar(80) NOT NULL,
	"resource_type" varchar(80),
	"resource_id" varchar(120),
	"ip" varchar(45),
	"user_agent" varchar(500),
	"detail" jsonb,
	"status" varchar(20) DEFAULT 'success' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operation_logs_status_chk" CHECK ("operation_logs"."status" in ('success', 'failure'))
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"setting_key" varchar(150) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"icon" varchar(120),
	"color" varchar(20),
	"parent_id" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"summary" varchar(300) DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category_id" integer,
	"visibility" varchar(20) DEFAULT 'public' NOT NULL,
	"lifecycle" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "api_products_visibility_chk" CHECK ("api_products"."visibility" in ('public', 'private')),
	CONSTRAINT "api_products_lifecycle_chk" CHECK ("api_products"."lifecycle" in ('active', 'deprecated', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "api_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_version_id" uuid NOT NULL,
	"name" varchar(160) NOT NULL,
	"hosts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"method" varchar(10) NOT NULL,
	"path_pattern" varchar(1000) NOT NULL,
	"normalized_shape" varchar(1000) NOT NULL,
	"upstream_service_id" uuid NOT NULL,
	"upstream_path_template" varchar(1000) NOT NULL,
	"is_api_key" boolean DEFAULT false NOT NULL,
	"is_statistics" boolean DEFAULT true NOT NULL,
	"credits_cost" integer DEFAULT 0 NOT NULL,
	"rate_limit_per_second" integer DEFAULT 0 NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 0 NOT NULL,
	"rate_limit_per_hour" integer DEFAULT 0 NOT NULL,
	"rate_limit_per_day" integer DEFAULT 0 NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"max_request_bytes" integer DEFAULT 1048576 NOT NULL,
	"max_response_bytes" integer DEFAULT 10485760 NOT NULL,
	"catalog_status" varchar(20) DEFAULT 'automatic' NOT NULL,
	"sensitive_query_parameters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_support_route" boolean DEFAULT false NOT NULL,
	"state" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "api_routes_method_chk" CHECK ("api_routes"."method" in ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE')),
	CONSTRAINT "api_routes_credits_cost_chk" CHECK ("api_routes"."credits_cost" >= 0),
	CONSTRAINT "api_routes_rate_limits_chk" CHECK ("api_routes"."rate_limit_per_second" >= 0 and "api_routes"."rate_limit_per_minute" >= 0 and "api_routes"."rate_limit_per_hour" >= 0 and "api_routes"."rate_limit_per_day" >= 0),
	CONSTRAINT "api_routes_paid_policy_chk" CHECK ("api_routes"."credits_cost" = 0 or ("api_routes"."is_api_key" = true and "api_routes"."is_statistics" = true)),
	CONSTRAINT "api_routes_timeout_chk" CHECK ("api_routes"."timeout_ms" between 100 and 120000),
	CONSTRAINT "api_routes_request_bytes_chk" CHECK ("api_routes"."max_request_bytes" between 0 and 1073741824),
	CONSTRAINT "api_routes_response_bytes_chk" CHECK ("api_routes"."max_response_bytes" between 0 and 2147483647),
	CONSTRAINT "api_routes_catalog_status_chk" CHECK ("api_routes"."catalog_status" in ('automatic', 'maintenance')),
	CONSTRAINT "api_routes_state_chk" CHECK ("api_routes"."state" in ('draft', 'active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "api_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" varchar(80) NOT NULL,
	"state" varchar(20) DEFAULT 'draft' NOT NULL,
	"openapi_document_id" uuid,
	"changelog" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"deprecated_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	CONSTRAINT "api_versions_state_chk" CHECK ("api_versions"."state" in ('draft', 'published', 'deprecated', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "openapi_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upstream_service_id" uuid,
	"source_type" varchar(20) NOT NULL,
	"source_url" text,
	"format" varchar(10) NOT NULL,
	"spec_version" varchar(20) NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"parsed_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "openapi_documents_source_type_chk" CHECK ("openapi_documents"."source_type" in ('upload', 'url')),
	CONSTRAINT "openapi_documents_format_chk" CHECK ("openapi_documents"."format" in ('json', 'yaml'))
);
--> statement-breakpoint
CREATE TABLE "platform_runtime" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_domain" varchar(253),
	"active_revision_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_runtime_singleton_chk" CHECK ("platform_runtime"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "routing_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sequence" integer NOT NULL,
	"config_payload" jsonb NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "routing_revisions_sequence_chk" CHECK ("routing_revisions"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "upstream_service_connections" (
	"upstream_service_id" uuid PRIMARY KEY NOT NULL,
	"service_token_ciphertext" text NOT NULL,
	"pending_service_token_ciphertext" text,
	"service_id" varchar(120),
	"service_name" varchar(160),
	"service_version" varchar(160),
	"service_commit" varchar(160),
	"service_protocol" varchar(80),
	"service_description" jsonb,
	"openapi_sha256" varchar(64),
	"configuration_schema_sha256" varchar(64),
	"configuration_schema" jsonb,
	"configuration_values" jsonb DEFAULT '{"values":{},"secrets":{}}'::jsonb NOT NULL,
	"configuration_revision" integer DEFAULT 0 NOT NULL,
	"configuration_hash" varchar(64),
	"last_discovered_at" timestamp with time zone,
	"last_configuration_sync_at" timestamp with time zone,
	"last_discovery_error" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upstream_service_connections_revision_chk" CHECK ("upstream_service_connections"."configuration_revision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "upstream_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(160) NOT NULL,
	"openapi_document_id" uuid,
	"load_balancing" varchar(30) DEFAULT 'round_robin' NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "upstream_services_load_balancing_chk" CHECK ("upstream_services"."load_balancing" in ('round_robin', 'weighted')),
	CONSTRAINT "upstream_services_status_chk" CHECK ("upstream_services"."status" in ('active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "upstream_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upstream_service_id" uuid NOT NULL,
	"base_url" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_error" varchar(500),
	"configuration_revision" integer,
	"configuration_hash" varchar(64),
	"configuration_status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"configuration_state" jsonb,
	"last_configuration_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upstream_targets_weight_chk" CHECK ("upstream_targets"."weight" between 1 and 10000),
	CONSTRAINT "upstream_targets_configuration_revision_chk" CHECK ("upstream_targets"."configuration_revision" is null or "upstream_targets"."configuration_revision" >= 0),
	CONSTRAINT "upstream_targets_configuration_status_chk" CHECK ("upstream_targets"."configuration_status" in ('unknown', 'synced', 'drifted', 'error'))
);
--> statement-breakpoint
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_credit_reservations" ADD CONSTRAINT "api_credit_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_message_id_notification_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."notification_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_categories" ADD CONSTRAINT "api_categories_parent_id_api_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."api_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_products" ADD CONSTRAINT "api_products_category_id_api_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."api_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_routes" ADD CONSTRAINT "api_routes_api_version_id_api_versions_id_fk" FOREIGN KEY ("api_version_id") REFERENCES "public"."api_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_routes" ADD CONSTRAINT "api_routes_service_connection_fk" FOREIGN KEY ("upstream_service_id") REFERENCES "public"."upstream_service_connections"("upstream_service_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_versions" ADD CONSTRAINT "api_versions_product_id_api_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."api_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_versions" ADD CONSTRAINT "api_versions_openapi_document_id_openapi_documents_id_fk" FOREIGN KEY ("openapi_document_id") REFERENCES "public"."openapi_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openapi_documents" ADD CONSTRAINT "openapi_documents_upstream_service_id_upstream_services_id_fk" FOREIGN KEY ("upstream_service_id") REFERENCES "public"."upstream_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_runtime" ADD CONSTRAINT "platform_runtime_active_revision_id_routing_revisions_id_fk" FOREIGN KEY ("active_revision_id") REFERENCES "public"."routing_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_service_connections" ADD CONSTRAINT "upstream_service_connections_service_fk" FOREIGN KEY ("upstream_service_id") REFERENCES "public"."upstream_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_services" ADD CONSTRAINT "upstream_services_openapi_document_id_openapi_documents_id_fk" FOREIGN KEY ("openapi_document_id") REFERENCES "public"."openapi_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_targets" ADD CONSTRAINT "upstream_targets_upstream_service_id_upstream_services_id_fk" FOREIGN KEY ("upstream_service_id") REFERENCES "public"."upstream_services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_transactions_created_at_idx" ON "credit_transactions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_transactions_user_created_idx" ON "credit_transactions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credit_transactions_reason_idx" ON "credit_transactions" USING btree ("reason");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_api_call_reason_uq" ON "credit_transactions" USING btree ("api_call_id","reason") WHERE "credit_transactions"."api_call_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_reservation_uq" ON "credit_transactions" USING btree ("credit_reservation_id") WHERE "credit_transactions"."credit_reservation_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_redemption_user_uq" ON "credit_transactions" USING btree ("code_id","user_id") WHERE "credit_transactions"."reason" = 'redemption_code' AND "credit_transactions"."code_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "redemption_codes_batch_idx" ON "redemption_codes" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "redemption_codes_enabled_expires_idx" ON "redemption_codes" USING btree ("is_enabled","expires_at");--> statement-breakpoint
CREATE INDEX "redemption_codes_created_at_idx" ON "redemption_codes" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_uq" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_active_banned_idx" ON "users" USING btree ("is_active","is_banned");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_provider_pid_uq" ON "oauth_accounts" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_accounts_user_provider_uq" ON "oauth_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE INDEX "api_call_stats_stat_date_idx" ON "api_call_stats" USING btree ("stat_date");--> statement-breakpoint
CREATE INDEX "api_calls_created_at_idx" ON "api_calls" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_calls_route_created_at_idx" ON "api_calls" USING btree ("route_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_calls_user_created_at_idx" ON "api_calls" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_calls_api_key_created_at_idx" ON "api_calls" USING btree ("api_key_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "api_calls_request_id_idx" ON "api_calls" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "api_credit_reservations_user_status_idx" ON "api_credit_reservations" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "api_credit_reservations_status_next_attempt_idx" ON "api_credit_reservations" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "api_credit_reservations_created_idx" ON "api_credit_reservations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "api_credit_reservations_request_idx" ON "api_credit_reservations" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "api_credit_reservations_route_idx" ON "api_credit_reservations" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "announcements_enabled_pin_sort_idx" ON "announcements" USING btree ("is_enabled","is_pinned","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_msg_user_uq" ON "notification_deliveries" USING btree ("message_id","recipient_user_id");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_created_idx" ON "notification_deliveries" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_user_unread_idx" ON "notification_deliveries" USING btree ("recipient_user_id","is_read");--> statement-breakpoint
CREATE INDEX "notification_messages_audience_idx" ON "notification_messages" USING btree ("audience");--> statement-breakpoint
CREATE INDEX "notification_messages_created_at_idx" ON "notification_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "operation_logs_created_at_idx" ON "operation_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operation_logs_user_created_idx" ON "operation_logs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operation_logs_user_action_created_idx" ON "operation_logs" USING btree ("user_id","action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "operation_logs_action_idx" ON "operation_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "operation_logs_resource_idx" ON "operation_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_categories_code_uq" ON "api_categories" USING btree ("code") WHERE "api_categories"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "api_categories_parent_sort_idx" ON "api_categories" USING btree ("parent_id","sort_order");--> statement-breakpoint
CREATE INDEX "api_categories_enabled_sort_idx" ON "api_categories" USING btree ("is_enabled","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "api_products_slug_uq" ON "api_products" USING btree ("slug") WHERE "api_products"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "api_products_lifecycle_idx" ON "api_products" USING btree ("lifecycle");--> statement-breakpoint
CREATE INDEX "api_products_category_idx" ON "api_products" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_routes_version_method_shape_uq" ON "api_routes" USING btree ("api_version_id","method","normalized_shape") WHERE "api_routes"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "api_routes_version_state_idx" ON "api_routes" USING btree ("api_version_id","state");--> statement-breakpoint
CREATE INDEX "api_routes_upstream_idx" ON "api_routes" USING btree ("upstream_service_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_versions_product_version_uq" ON "api_versions" USING btree ("product_id","version");--> statement-breakpoint
CREATE INDEX "api_versions_product_state_idx" ON "api_versions" USING btree ("product_id","state");--> statement-breakpoint
CREATE INDEX "openapi_documents_created_idx" ON "openapi_documents" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "openapi_documents_upstream_hash_uq" ON "openapi_documents" USING btree ("upstream_service_id","content_hash") WHERE "openapi_documents"."upstream_service_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "routing_revisions_sequence_uq" ON "routing_revisions" USING btree ("sequence");--> statement-breakpoint
CREATE INDEX "routing_revisions_created_idx" ON "routing_revisions" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "routing_revisions_checksum_idx" ON "routing_revisions" USING btree ("checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "upstream_services_slug_uq" ON "upstream_services" USING btree ("slug") WHERE "upstream_services"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "upstream_services_status_idx" ON "upstream_services" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "upstream_targets_service_url_uq" ON "upstream_targets" USING btree ("upstream_service_id","base_url");--> statement-breakpoint
CREATE INDEX "upstream_targets_service_enabled_idx" ON "upstream_targets" USING btree ("upstream_service_id","enabled");