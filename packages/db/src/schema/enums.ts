import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enum types, ported 1:1 from the prototype's implied enumerations
 * (index.html). Keeping these as real DB enums makes illegal states
 * unrepresentable at the storage layer, not just in TypeScript.
 */

// `partner_code` used to live here as an enum of eight institutions. It was
// removed in 0011: the list of partners CCN routes to is not a closed set fixed
// at schema time, and onboarding a ninth needed a migration and a deploy for
// the most ordinary commercial event this company has. `partners.code` is text
// with a shape CHECK and a UNIQUE — which is what the enum was really for.

export const regulator = pgEnum('regulator', [
  'FSC_JAMAICA',
  'FSC_BARBADOS',
  'GSC_GUYANA',
  'TTSEC_TRINIDAD_TOBAGO',
  // Retained for migration compatibility; new Trinidad records use TTSEC.
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

export const currency = pgEnum('currency', ['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD']);

export const withdrawalStatus = pgEnum('withdrawal_status', ['pending', 'paid', 'declined']);

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

/**
 * Whether an instrument is offered in the marketplace.
 *
 * Distinct from `blocked`, which means "screened out for your suitability" and
 * renders to the investor as a refusal with reasons. A paused listing is simply
 * not offered — the firm has taken it off the shelf.
 */
export const listingStatus = pgEnum('listing_status', ['live', 'paused']);

/**
 * A client's standing at one partner. An investor links an account; the partner
 * reviews the KYC package CCN passes across and accepts or declines them. CCN is
 * not the KYC owner, so the relationship is not real until the firm says it is.
 */
export const connectionStatus = pgEnum('connection_status', ['pending', 'active', 'declined']);

export const reconciliationStatus = pgEnum('reconciliation_status', [
  'pending',
  'matched',
  'rejected',
]);

/** Durable delivery state for partner-owned audit-event webhook exports. */
export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'pending',
  'processing',
  'delivered',
  'failed',
  'dead',
]);

// UI accessibility prefs persisted per user (packages/ui text-size + contrast controls).
export const uiScale = pgEnum('ui_scale', ['base', 'lg', 'xl', 'xxl']);
export const contrastPref = pgEnum('contrast_pref', ['normal', 'high']);
export const themePref = pgEnum('theme_pref', ['system', 'light', 'dark']);
