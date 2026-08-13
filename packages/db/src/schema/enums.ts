import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enum types, ported 1:1 from the prototype's implied enumerations
 * (index.html). Keeping these as real DB enums makes illegal states
 * unrepresentable at the storage layer, not just in TypeScript.
 */

// FSC-licensed partner network (+ GK GraceKennedy issuer, distributed via Barita).
export const partnerCode = pgEnum('partner_code', [
  'NCB',
  'SAG',
  'PRV',
  'JMMB',
  'BAR',
  'REP',
  'SYG',
  'GK',
]);

export const regulator = pgEnum('regulator', [
  'FSC_JAMAICA',
  'FSC_BARBADOS',
  'FSC_TRINIDAD_TOBAGO',
]);

// A partner connection grants read (aggregate holdings) and/or trade (route orders).
export const partnerScope = pgEnum('partner_scope', ['read', 'trade']);

// Lifecycle gate: no live order routing until the agreement is `live` (DPA signed).
export const agreementStatus = pgEnum('agreement_status', [
  'prospect',
  'dpa_pending',
  'sandbox',
  'live',
  'suspended',
]);

export const instrumentType = pgEnum('instrument_type', [
  'bond',
  'fund',
  'equity',
  'real_estate',
  'private',
]);

// Per-instrument risk rating shown in the marketplace.
export const riskRating = pgEnum('risk_rating', ['low', 'medium', 'high']);

// Suitability band from the onboarding risk quiz (avg of 3 answers → band).
export const riskBand = pgEnum('risk_band', [
  'low',
  'low_moderate',
  'high_moderate',
  'low_high',
  'high',
]);

export const currency = pgEnum('currency', ['USD', 'JMD', 'TTD']);

// Order state machine (prototype "new" == created). Terminal: settled/rejected/expired.
export const orderStatus = pgEnum('order_status', [
  'created',
  'accepted',
  'settled',
  'rejected',
  'expired',
]);

export const approvalType = pgEnum('approval_type', [
  'investment_rec',
  'fund_transfer',
  'plan_enrollment',
]);

export const approvalStatus = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'expired',
]);

export const appRole = pgEnum('role', [
  'customer',
  'partner_operator',
  'compliance',
  'admin',
  'analyst', // Gateway introduction/opportunity review — see packages/db/src/schema/gateway.ts
]);

export const kycStep = pgEnum('kyc_step', ['identity', 'compliance', 'risk', 'funds']);

export const kycTier = pgEnum('kyc_tier', ['none', 'tier1', 'tier2']);

// Who performed an audited action.
export const actorType = pgEnum('actor_type', ['user', 'agent', 'compliance', 'system']);

export const planningStatus = pgEnum('planning_status', ['recommended', 'available', 'explore']);

export const sourceOfFunds = pgEnum('source_of_funds', [
  'investment',
  'salary',
  'business',
  'other',
]);

export const productListingStatus = pgEnum('product_listing_status', ['live', 'paused']);

export const reconciliationStatus = pgEnum('reconciliation_status', [
  'pending',
  'matched',
  'rejected',
]);

// UI accessibility prefs persisted per user (packages/ui text-size + contrast controls).
export const uiScale = pgEnum('ui_scale', ['base', 'lg', 'xl', 'xxl']);
export const contrastPref = pgEnum('contrast_pref', ['normal', 'high']);
export const themePref = pgEnum('theme_pref', ['system', 'light', 'dark']);
