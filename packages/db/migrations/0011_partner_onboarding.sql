-- ---------------------------------------------------------------------------
-- Onboarding a partner.
--
-- `partners.code` was a Postgres enum of exactly eight values — the network as
-- it stood when the schema was first written. Making illegal states
-- unrepresentable is the right instinct and it was applied to the wrong column:
-- the set of licensed institutions CCN can route to is not a closed set decided
-- at schema time, it is the business. With an enum, onboarding a ninth partner
-- required a migration, a deploy and an engineer — for the single most ordinary
-- commercial event this company has.
--
-- So `code` becomes text with a shape constraint. What the enum was actually
-- protecting — that a code is a short uppercase identifier and that no two
-- partners share one — is kept: the CHECK enforces the shape and the existing
-- UNIQUE still enforces the rest. What it was wrongly protecting — the specific
-- list — is now the administration surface's to decide, where it belongs.
--
-- The type is used by nothing else (one column, no function signature, no
-- view), so this is a contained change and the type goes with it. Existing
-- values survive verbatim: an enum's text representation is the label.
--
-- `regulator` and `agreement_status` stay enums, deliberately. Those ARE closed
-- sets — three regulators CCN is licensed under and five lifecycle states the
-- order-routing gate reads — and a partner with a misspelled agreement status
-- would silently never go live.
--
-- Nothing new is granted here. 0010 already gave `admin` INSERT and UPDATE on
-- this table and nothing else; this only widens what a valid code may be.
-- ---------------------------------------------------------------------------

ALTER TABLE "partners" ALTER COLUMN "code" TYPE text USING "code"::text;--> statement-breakpoint

-- Short, uppercase, unambiguous: 'SAG', 'JMMB', 'GK'. Two to twelve characters
-- so a code stays readable in a badge and in a URL, and never collides with a
-- name. Enforced here rather than in a handler, because a code is written by
-- the seed and by the API and will be written by whatever comes next.
ALTER TABLE "partners" ADD CONSTRAINT "partners_code_shape"
  CHECK ("code" ~ '^[A-Z][A-Z0-9]{1,11}$');--> statement-breakpoint

DROP TYPE IF EXISTS "public"."partner_code";
