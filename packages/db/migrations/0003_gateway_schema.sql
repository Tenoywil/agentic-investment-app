CREATE TYPE "public"."gateway_deal_stage" AS ENUM('intro', 'dd', 'term_sheet', 'closed', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."gateway_evidence_status" AS ENUM('verified', 'partially_verified', 'self_reported', 'unverified', 'contradicted');--> statement-breakpoint
CREATE TYPE "public"."gateway_introduction_status" AS ENUM('requested', 'approved', 'rejected', 'completed');--> statement-breakpoint
CREATE TYPE "public"."gateway_opportunity_status" AS ENUM('submitted', 'assessed', 'pending_review', 'approved', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'analyst';--> statement-breakpoint
CREATE TABLE "gateway_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid,
	"user_id" uuid,
	"pass" text NOT NULL,
	"tier" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text DEFAULT 'v1' NOT NULL,
	"input" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"output" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" numeric(4, 3),
	"tool_calls" integer DEFAULT 0 NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"category" text,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"introduction_request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"stage" "gateway_deal_stage" DEFAULT 'intro' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_deals_introduction_request_id_unique" UNIQUE("introduction_request_id")
);
--> statement-breakpoint
CREATE TABLE "gateway_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"label" text NOT NULL,
	"storage_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"status" "gateway_evidence_status" DEFAULT 'unverified' NOT NULL,
	"source" text,
	"detail" text,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_introduction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"status" "gateway_introduction_status" DEFAULT 'requested' NOT NULL,
	"note" text,
	"decision_reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"component_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reasons" text[] DEFAULT '{}' NOT NULL,
	"concerns" text[] DEFAULT '{}' NOT NULL,
	"used_semantic_proxy" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_matches_user_opportunity_uq" UNIQUE("user_id","opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "gateway_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submitted_by" uuid,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"sector" text NOT NULL,
	"stage" text NOT NULL,
	"investment_type" text NOT NULL,
	"capital_sought_minor" bigint NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"valuation_minor" bigint,
	"use_of_funds" text,
	"target_return_pct" numeric(6, 2) NOT NULL,
	"horizon_years" integer NOT NULL,
	"risk_rating" "risk_rating" NOT NULL,
	"liquidity" "risk_rating" NOT NULL,
	"offers_board_seat" boolean DEFAULT false NOT NULL,
	"has_impact_focus" boolean DEFAULT false NOT NULL,
	"exit_assumptions" text,
	"summary" text NOT NULL,
	"status" "gateway_opportunity_status" DEFAULT 'submitted' NOT NULL,
	"readiness_score" integer,
	"critical_missing_items" text[] DEFAULT '{}' NOT NULL,
	"disclosures" text[] DEFAULT '{}' NOT NULL,
	"guardrail_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investor_mandates" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"narrative" text,
	"countries" text[] DEFAULT '{}' NOT NULL,
	"sectors" text[] DEFAULT '{}' NOT NULL,
	"min_check_minor" bigint NOT NULL,
	"max_check_minor" bigint NOT NULL,
	"stage_preferences" text[] DEFAULT '{}' NOT NULL,
	"risk_appetite" "risk_rating" NOT NULL,
	"horizon_years" integer NOT NULL,
	"target_return_pct" numeric(6, 2) NOT NULL,
	"liquidity_need" "risk_rating" NOT NULL,
	"board_involvement" boolean DEFAULT false NOT NULL,
	"impact_preference" boolean DEFAULT false NOT NULL,
	"currency" "currency" DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gateway_agent_runs" ADD CONSTRAINT "gateway_agent_runs_opportunity_id_gateway_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."gateway_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_agent_runs" ADD CONSTRAINT "gateway_agent_runs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_claims" ADD CONSTRAINT "gateway_claims_opportunity_id_gateway_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."gateway_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_deals" ADD CONSTRAINT "gateway_deals_introduction_request_id_gateway_introduction_requests_id_fk" FOREIGN KEY ("introduction_request_id") REFERENCES "public"."gateway_introduction_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_deals" ADD CONSTRAINT "gateway_deals_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_deals" ADD CONSTRAINT "gateway_deals_opportunity_id_gateway_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."gateway_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_documents" ADD CONSTRAINT "gateway_documents_opportunity_id_gateway_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."gateway_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_evidence" ADD CONSTRAINT "gateway_evidence_claim_id_gateway_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."gateway_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_evidence" ADD CONSTRAINT "gateway_evidence_document_id_gateway_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."gateway_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_introduction_requests" ADD CONSTRAINT "gateway_introduction_requests_match_id_gateway_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."gateway_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_introduction_requests" ADD CONSTRAINT "gateway_introduction_requests_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_introduction_requests" ADD CONSTRAINT "gateway_introduction_requests_opportunity_id_gateway_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."gateway_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_introduction_requests" ADD CONSTRAINT "gateway_introduction_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_matches" ADD CONSTRAINT "gateway_matches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_matches" ADD CONSTRAINT "gateway_matches_opportunity_id_gateway_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."gateway_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_opportunities" ADD CONSTRAINT "gateway_opportunities_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_mandates" ADD CONSTRAINT "investor_mandates_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;