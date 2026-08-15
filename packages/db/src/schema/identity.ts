import {
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import {
  appRole,
  contrastPref,
  currency,
  kycStep,
  kycTier,
  riskBand,
  sourceOfFunds,
  themePref,
  uiScale,
} from './enums';
import { createdAt, updatedAt } from './helpers';

/**
 * Per-user profile: display currency, diaspora corridor, residency, and the
 * accessibility preferences the packages/ui controls persist (text size,
 * contrast, theme). One row per auth user.
 */
export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  displayCurrency: currency('display_currency').notNull().default('USD'),
  corridor: text('corridor'),
  residencyCountry: text('residency_country'),
  occupation: text('occupation'),
  uiScale: uiScale('ui_scale').notNull().default('base'),
  contrastPref: contrastPref('contrast_pref').notNull().default('normal'),
  themePref: themePref('theme_pref').notNull().default('system'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * RBAC. A user may hold several roles; `partner_operator` is bound to the
 * partner it operates (partnerId), which drives `app.current_partner_id`.
 */
export const userRoles = pgTable(
  'user_roles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: appRole('role').notNull().default('customer'),
    // FK added in a later migration to avoid a cycle with partners.
    partnerId: uuid('partner_id'),
    createdAt: createdAt(),
  },
  (t) => [unique('user_roles_user_role_partner_uq').on(t.userId, t.role, t.partnerId)],
);

/** Suitability band from the onboarding quiz (avg of the 3 answers → band). */
export const riskProfiles = pgTable('risk_profiles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  answers: jsonb('answers').notNull(), // { q1: 'A'..'E', q2, q3 } with per-answer scores
  score: integer('score').notNull(), // sum of the three answer scores
  band: riskBand('band').notNull(),
  createdAt: createdAt(),
});

/**
 * Consent-based KYC status — CCN is NOT the KYC owner; this records the verified
 * outcome and declarations. Actual documents live in private Storage, referenced
 * by kyc_documents.
 */
export const kycStatus = pgTable('kyc_status', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  tier: kycTier('tier').notNull().default('none'),
  identityVerified: boolean('identity_verified').notNull().default(false),
  complianceConfirmed: boolean('compliance_confirmed').notNull().default(false),
  riskCompleted: boolean('risk_completed').notNull().default(false),
  fundsConfirmed: boolean('funds_confirmed').notNull().default(false),
  isPep: boolean('is_pep').notNull().default(false),
  taxResidencyDeclared: boolean('tax_residency_declared').notNull().default(false),
  sources: sourceOfFunds('sources').array().notNull().default([]),
  updatedAt: updatedAt(),
});

/**
 * A KYC / source-of-funds document, file included (0027).
 *
 * `storage_path` is the fossil of a Storage-bucket design that was never
 * built; rows written since 0027 carry the bytes themselves (≤2MB, enforced by
 * a CHECK), so the file inherits this table's RLS — owner, CCN admin, and the
 * firm the owner is a pending/active client of — instead of a bucket ACL that
 * could disagree with it. `step` doubles as the document kind.
 */
export const kycDocuments = pgTable('kyc_documents', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  step: kycStep('step').notNull(),
  label: text('label').notNull(),
  storagePath: text('storage_path'), // legacy; null on rows that carry bytes
  mime: text('mime'),
  bytes: customType<{ data: Uint8Array }>({ dataType: () => 'bytea' })('bytes'),
  createdAt: createdAt(),
});
