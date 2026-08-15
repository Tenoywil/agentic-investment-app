import type { ConsoleActorType, ConsoleAgreementStatus, ConsoleCurrency } from '@/lib/console-api';
import type { MePartner } from '@/lib/me-api';
import {
  ArrowRightLeft,
  Boxes,
  LayoutGrid,
  type LucideIcon,
  ShieldCheck,
  Users,
} from 'lucide-react';

/**
 * Shared vocabulary for the partner console: the tab set, the formatters, and
 * the enum→label maps.
 *
 * The maps below are the *only* legitimate hardcoded strings on this surface.
 * They translate values the database actually stores (`agreement_status`,
 * `regulator`, `actor_type`, an audit `action` key) into English. Nothing here
 * asserts a fact about any particular firm — if a value is missing, the caller
 * hides the element rather than substituting a plausible-looking default.
 */

export type TabKey = 'overview' | 'orders' | 'products' | 'clients' | 'compliance';

export const TABS: { key: TabKey; label: string; Icon: LucideIcon }[] = [
  { key: 'overview', label: 'Overview', Icon: LayoutGrid },
  { key: 'orders', label: 'Order flow', Icon: ArrowRightLeft },
  { key: 'products', label: 'Products', Icon: Boxes },
  { key: 'clients', label: 'Clients & KYC', Icon: Users },
  { key: 'compliance', label: 'Compliance', Icon: ShieldCheck },
];

export const TAB_TITLES: Record<TabKey, string> = {
  overview: 'overview',
  orders: 'order flow',
  products: 'products',
  clients: 'clients & KYC',
  compliance: 'compliance',
};

/* ---- shared class fragments -------------------------------------------- */

export const uppr = 'text-[11px] font-bold uppercase tracking-wider text-faint';
/**
 * Status text colours as explicit light/dark pairs rather than the --success /
 * --terra tokens.
 *
 * Those tokens are tuned for fills and large numerals; at 13–14px on the card
 * surface the light-theme values land at 3.8–4.0:1, under the 4.5:1 floor for
 * body text. These pairs clear it in both themes.
 */
export const SUCCESS_TEXT = 'text-[#0a6e44] dark:text-[#5fce9e]';
export const TERRA_TEXT = 'text-[#a44e20] dark:text-terra';
export const errorText = `flex items-center gap-2 text-sm ${TERRA_TEXT}`;
export const TERRA_GHOST_BTN =
  'text-[#a44e20] hover:bg-[#f5e7d9] hover:text-[#a44e20] dark:text-terra dark:hover:bg-[#3a281c] dark:hover:text-terra';
/** Outlined Settle button. The --terra token itself is only 3.7:1 on the light
 *  card, so the light half is darkened; the border clears 3:1 either way. */
export const TERRA_OUTLINE_BTN =
  'border-solid border-[#a44e20] text-[#a44e20] hover:bg-transparent hover:text-[#a44e20] dark:border-terra dark:text-terra dark:hover:text-terra';
/**
 * A single hairline under a table row.
 *
 * Preflight is off, which cuts both ways. `border-b border-border` alone paints
 * nothing, because nothing sets `border-style`. Adding `border-solid` sets the
 * style on all four sides — and with no preflight there is no
 * `border-width: 0` reset either, so the other three inherit the CSS initial
 * value of `medium` and every row grows a 3px box. Both other axes therefore
 * have to be zeroed explicitly.
 */
export const ROW_DIVIDER = 'border-x-0 border-t-0 border-b border-solid border-border';

/* ---- formatting --------------------------------------------------------- */

const CURRENCY_PREFIX: Record<ConsoleCurrency, string> = { USD: 'US$', JMD: 'J$', TTD: 'TT$' };

export function fmtMinor(minor: string, currency: ConsoleCurrency): string {
  const n = Number(minor) / 100;
  return `${CURRENCY_PREFIX[currency]}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * The same, to the cent.
 *
 * Order amounts are whole-unit figures where cents are noise. An execution
 * price is not: rounding a unit price of 100.25 to "US$100" would misstate the
 * number the firm reported, which is the only reason that column exists.
 */
export function fmtMinorExact(minor: string, currency: ConsoleCurrency): string {
  const n = Number(minor) / 100;
  return `${CURRENCY_PREFIX[currency]}${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// `fmtAumUSD` was here, formatting product_listings.aum_minor into "US$14.2M".
// Deleted along with the column it rendered: CCN runs no AUM roll-up, so the
// number was invented. A formatter left lying around for a metric we do not
// compute is an invitation to put the claim back.

export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/* ---- partner enums ------------------------------------------------------ */

const REGULATOR_LABELS: Record<string, string> = {
  FSC_JAMAICA: 'FSC Jamaica',
  FSC_BARBADOS: 'FSC Barbados',
  FSC_TRINIDAD_TOBAGO: 'FSC Trinidad & Tobago',
};

/** The regulator's display name, or null when the partner row has none — in
 *  which case the caller shows nothing rather than guessing a jurisdiction. */
export function regulatorLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return REGULATOR_LABELS[value] ?? value;
}

const AGREEMENT_LABELS: Record<ConsoleAgreementStatus, string> = {
  prospect: 'Prospect',
  dpa_pending: 'DPA pending',
  sandbox: 'Sandbox',
  live: 'Active',
  suspended: 'Suspended',
};

export function agreementLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return AGREEMENT_LABELS[value as ConsoleAgreementStatus] ?? value;
}

/** Headline for the sidebar pill. `live` is the only status that may say so. */
export function agreementHeadline(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'live') return 'Agreement active';
  const label = agreementLabel(value);
  return label ? `Agreement · ${label.toLowerCase()}` : null;
}

/** Fixed light-on-dark dot colours: the sidebar is navy in both themes. */
export function agreementDot(value: string | null | undefined): string {
  if (value === 'live') return '#5fd3a6';
  if (value === 'suspended') return '#e79b6f';
  return '#f0c078';
}

/** Seeded KPI / funnel / listing figures belong to a sandbox partner, so they
 *  are real rows describing a rehearsal book. Panels that render them say so. */
export function isSandbox(partner: MePartner | null | undefined): boolean {
  return partner?.agreementStatus === 'sandbox';
}

/* ---- audit -------------------------------------------------------------- */

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'order.created': 'Order created',
  'order.accepted': 'Order accepted',
  'order.settled': 'Order settled',
  'order.rejected': 'Order rejected',
  'order.routed': 'Order routed to the firm',
  'order.routing_failed': 'Order could not be routed',
  'approval.approved': 'Client approved a recommendation',
  'approval.rejected': 'Client declined a recommendation',
  'reconciliation.matched': 'Statement line matched to a holding',
  'reconciliation.rejected': 'Statement line rejected',
  'reconciliation.pulled': 'Statements pulled for reconciliation',
  'instrument.listed': 'Product listed',
  'instrument.updated': 'Product details amended',
  'instrument.live': 'Product put back on the marketplace',
  'instrument.paused': 'Product taken off the marketplace',
  // `product_listings` is no longer written, but rows already in the chain
  // still name it — an append-only log keeps its history whatever the code does.
  'product_listing.live': 'Product listing set live',
  'product_listing.paused': 'Product listing paused',
  'product_listing.created': 'Product listed',
  'connected_account.requested': 'Client asked to link an account',
  'connected_account.linked': 'Client positions read into CCN',
  'connected_account.refreshed': 'Client positions refreshed',
  'client.accepted': 'Client accepted',
  'client.declined': 'Client declined',
  'client.revoked': 'Client access revoked',
  'client.reinstated': 'Client reinstated',
  'partner.onboarded': 'Firm onboarded to CCN',
  'partner.changed': 'Firm record changed by CCN',
  'user_roles.changed': 'Console access changed',
  'fx_rates.refreshed': 'Exchange rates refreshed',
  'reference_data.loaded': 'Reference data loaded',
};

/**
 * An audit action as a sentence.
 *
 * The unknown case used to print the raw key — `instrument.listed`,
 * `connected_account.refreshed` — at a compliance officer reading their firm's
 * regulated record. The map above is the curated wording; anything it has not
 * been taught is at least turned into words rather than shown as a database
 * identifier, since the log is append-only and will always carry actions
 * written by builds older than the screen reading them.
 */
export function auditActionLabel(action: string): string {
  const known = AUDIT_ACTION_LABELS[action];
  if (known) return known;
  const words = action.replace(/[._]/g, ' ').trim();
  if (!words) return action;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What an audit row was about, in the reader's vocabulary.
 *
 * `entity_type` is the table name the writer passed — `connected_accounts`,
 * `reconciliation_items` — and the compliance tab printed it verbatim under
 * every entry.
 */
const AUDIT_ENTITY_LABELS: Record<string, string> = {
  orders: 'Order',
  instruments: 'Product',
  product_listings: 'Product listing',
  connected_accounts: 'Client account',
  reconciliation_items: 'Statement line',
  approvals: 'Approval',
  holdings: 'Holding',
  partners: 'Firm',
  user_roles: 'Console access',
  fx_rates: 'Exchange rates',
  limits: 'Guardrails',
  goals: 'Goal',
};

export function auditEntityLabel(entityType: string | null | undefined): string | null {
  if (!entityType) return null;
  const known = AUDIT_ENTITY_LABELS[entityType];
  if (known) return known;
  const words = entityType.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** Decorative dot beside an audit row; the actor is also written out in text. */
export const AUDIT_ACTOR_DOT: Record<ConsoleActorType, string> = {
  user: 'bg-teal2',
  agent: 'bg-primary',
  compliance: 'bg-gold',
  system: 'bg-dim',
};

export const AUDIT_ACTOR_LABEL: Record<ConsoleActorType, string> = {
  user: 'Operator',
  agent: 'AI agent',
  compliance: 'Compliance',
  system: 'System',
};

/** `detail` is untyped JSONB. The only field worth surfacing is a rejection
 *  reason, and only when it really is a string. */
export function auditReason(detail: unknown): string | null {
  if (!detail || typeof detail !== 'object') return null;
  const reason = (detail as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.length > 0 ? reason : null;
}

/* ---- reconciliation ----------------------------------------------------- */

/** Reconciliation rows carry `parsed` as untyped JSONB — the ingestion
 *  pipeline writes { name, valueMinor, currency, returnLabel? }, but nothing
 *  guarantees that shape at the type level, so this reads it defensively. */
export interface ParsedHoldingGuess {
  name: string;
  valueMinor: string;
  currency: ConsoleCurrency;
  returnLabel?: string;
}

export function guessParsedHolding(parsed: unknown): ParsedHoldingGuess | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (
    typeof p.name !== 'string' ||
    typeof p.valueMinor !== 'string' ||
    (p.currency !== 'USD' && p.currency !== 'JMD' && p.currency !== 'TTD')
  ) {
    return null;
  }
  return {
    name: p.name,
    valueMinor: p.valueMinor,
    currency: p.currency,
    returnLabel: typeof p.returnLabel === 'string' ? p.returnLabel : undefined,
  };
}
