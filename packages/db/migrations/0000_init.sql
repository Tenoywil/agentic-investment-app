-- Extensions must exist before any table uses vector(384) or digest() (hash chain).
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'agent', 'compliance', 'system');--> statement-breakpoint
CREATE TYPE "public"."agreement_status" AS ENUM('prospect', 'dpa_pending', 'sandbox', 'live', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('customer', 'partner_operator', 'compliance', 'admin');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('investment_rec', 'fund_transfer', 'plan_enrollment');--> statement-breakpoint
CREATE TYPE "public"."contrast_pref" AS ENUM('normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USD', 'JMD', 'TTD');--> statement-breakpoint
CREATE TYPE "public"."instrument_type" AS ENUM('bond', 'fund', 'equity', 'real_estate', 'private');--> statement-breakpoint
CREATE TYPE "public"."kyc_step" AS ENUM('identity', 'compliance', 'risk', 'funds');--> statement-breakpoint
CREATE TYPE "public"."kyc_tier" AS ENUM('none', 'tier1', 'tier2');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('created', 'accepted', 'settled', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."partner_code" AS ENUM('NCB', 'SAG', 'PRV', 'JMMB', 'BAR', 'REP', 'SYG', 'GK');--> statement-breakpoint
CREATE TYPE "public"."partner_scope" AS ENUM('read', 'trade');--> statement-breakpoint
CREATE TYPE "public"."planning_status" AS ENUM('recommended', 'available', 'explore');--> statement-breakpoint
CREATE TYPE "public"."product_listing_status" AS ENUM('live', 'paused');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('pending', 'matched', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."regulator" AS ENUM('FSC_JAMAICA', 'FSC_BARBADOS', 'FSC_TRINIDAD_TOBAGO');--> statement-breakpoint
CREATE TYPE "public"."risk_band" AS ENUM('low', 'low_moderate', 'high_moderate', 'low_high', 'high');--> statement-breakpoint
CREATE TYPE "public"."risk_rating" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."source_of_funds" AS ENUM('investment', 'salary', 'business', 'other');--> statement-breakpoint
CREATE TYPE "public"."theme_pref" AS ENUM('system', 'light', 'dark');--> statement-breakpoint
CREATE TYPE "public"."ui_scale" AS ENUM('base', 'lg', 'xl', 'xxl');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"step" "kyc_step" NOT NULL,
	"label" text NOT NULL,
	"storage_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_status" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tier" "kyc_tier" DEFAULT 'none' NOT NULL,
	"identity_verified" boolean DEFAULT false NOT NULL,
	"compliance_confirmed" boolean DEFAULT false NOT NULL,
	"risk_completed" boolean DEFAULT false NOT NULL,
	"funds_confirmed" boolean DEFAULT false NOT NULL,
	"is_pep" boolean DEFAULT false NOT NULL,
	"tax_residency_declared" boolean DEFAULT false NOT NULL,
	"sources" "source_of_funds"[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"score" integer NOT NULL,
	"band" "risk_band" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_currency" "currency" DEFAULT 'USD' NOT NULL,
	"corridor" text,
	"residency_country" text,
	"occupation" text,
	"ui_scale" "ui_scale" DEFAULT 'base' NOT NULL,
	"contrast_pref" "contrast_pref" DEFAULT 'normal' NOT NULL,
	"theme_pref" "theme_pref" DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "role" DEFAULT 'customer' NOT NULL,
	"partner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_role_partner_uq" UNIQUE("user_id","role","partner_id")
);
--> statement-breakpoint
CREATE TABLE "connected_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base_currency" "currency" DEFAULT 'USD' NOT NULL,
	"quote_currency" "currency" NOT NULL,
	"rate" numeric(18, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_base_quote_uq" UNIQUE("base_currency","quote_currency")
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"instrument_id" uuid,
	"name" text NOT NULL,
	"value_minor" bigint DEFAULT 0 NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"return_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"abbr" text NOT NULL,
	"type" "instrument_type" NOT NULL,
	"partner_id" uuid,
	"regulator" "regulator",
	"name" text NOT NULL,
	"region" text,
	"metric_label" text,
	"metric" text,
	"min_investment_minor" bigint DEFAULT 0 NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"term" text,
	"risk" "risk_rating",
	"description" text,
	"agent_note" text,
	"blocked" boolean DEFAULT false NOT NULL,
	"block_reasons" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "kyc_funnel_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"label" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"pct" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_kpis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"sub" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" "partner_code" NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"regulator" "regulator",
	"agreement_status" "agreement_status" DEFAULT 'prospect' NOT NULL,
	"residency" text,
	"color" text,
	"tint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "planning_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"provider" text,
	"description" text,
	"status" "planning_status" DEFAULT 'available' NOT NULL,
	"accent" text,
	"tint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planning_products_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "product_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text,
	"clients" integer DEFAULT 0 NOT NULL,
	"aum_minor" bigint DEFAULT 0 NOT NULL,
	"trend" text,
	"status" "product_listing_status" DEFAULT 'live' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "approval_type" NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"instrument_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"amount_minor" bigint,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"content" text NOT NULL,
	"embedding" vector(384) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"target_minor" bigint NOT NULL,
	"current_minor" bigint DEFAULT 0 NOT NULL,
	"from_label" text,
	"pct" integer DEFAULT 0 NOT NULL,
	"eta" text,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"auto_invest_cap_minor" bigint DEFAULT 50000 NOT NULL,
	"auto_invest_enabled" boolean DEFAULT true NOT NULL,
	"cash_floor_minor" bigint DEFAULT 100000 NOT NULL,
	"cash_floor_enabled" boolean DEFAULT true NOT NULL,
	"fx_spread_max_bps" integer DEFAULT 30 NOT NULL,
	"fx_spread_enabled" boolean DEFAULT true NOT NULL,
	"require_approval_above_minor" bigint DEFAULT 100000 NOT NULL,
	"require_approval_enabled" boolean DEFAULT true NOT NULL,
	"single_position_max_pct" integer DEFAULT 15 NOT NULL,
	"single_position_enabled" boolean DEFAULT true NOT NULL,
	"daily_cap_minor" bigint,
	"daily_cap_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"instrument_id" uuid,
	"approval_id" uuid,
	"status" "order_status" DEFAULT 'created' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"idempotency_key" text NOT NULL,
	"client_ref" text,
	"settlement_eta" timestamp with time zone,
	"rejected_reason" text,
	"created_by" "actor_type" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "orders_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"partner_id" uuid,
	"source" text DEFAULT 'statement_ingestion' NOT NULL,
	"storage_path" text,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"parsed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "reconciliation_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"user_id" uuid,
	"partner_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"through_seq" bigint NOT NULL,
	"row_count" bigint NOT NULL,
	"checkpoint_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_status" ADD CONSTRAINT "kyc_status_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "connected_accounts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instruments" ADD CONSTRAINT "instruments_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_funnel_stages" ADD CONSTRAINT "kyc_funnel_stages_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_kpis" ADD CONSTRAINT "partner_kpis_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_listings" ADD CONSTRAINT "product_listings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limits" ADD CONSTRAINT "limits_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_approval_id_approvals_id_fk" FOREIGN KEY ("approval_id") REFERENCES "public"."approvals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;