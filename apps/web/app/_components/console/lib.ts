import type {
  ConsoleActorType,
  ConsoleAgreementStatus,
  ConsoleCurrency,
  ProductInput,
} from '@/lib/console-api';
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

/**
 * Turn a URL section into a real console destination. Unknown or absent
 * values land on Overview rather than producing a tab shell with no content.
 */
export function consoleTab(value: string | null): TabKey {
  return TABS.some(({ key }) => key === value) ? (value as TabKey) : 'overview';
}

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

const CURRENCY_PREFIX: Record<ConsoleCurrency, string> = {
  USD: 'US$',
  JMD: 'J$',
  TTD: 'TT$',
  GYD: 'G$',
  BBD: 'Bds$',
  XCD: 'EC$',
  BSD: 'B$',
};

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

/** Whole days since an ISO timestamp. */
export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * An order still waiting for acceptance after this many days is aging on the
 * desk. Investors are told "the firm is reviewing it"; past this point that
 * sentence is wearing thin, and the console should feel it before the client
 * phones.
 */
export const ORDER_AGING_DAYS = 2;

/* ---- product import ----------------------------------------------------- */

const PRODUCT_IMPORT_MAX_BYTES = 256_000;
export const PRODUCT_IMPORT_MAX_ROWS = 100;

export const PRODUCT_CSV_TEMPLATE = `name,type,abbr,currency,minimum_investment,term,metric,metric_label,risk,description,region
Sample Caribbean Income Fund,fund,SCIF,USD,5000,Open-ended,6.5%,Illustrative yield,medium,"Replace this sample row with your product description",Caribbean
`;

export interface ProductImportResult {
  products: ProductInput[];
  errors: string[];
}

interface DelimitedRow {
  cells: string[];
  line: number;
}

const PRODUCT_IMPORT_HEADERS = new Set([
  'name',
  'type',
  'abbr',
  'currency',
  'minimum_investment',
  'term',
  'metric',
  'metric_label',
  'risk',
  'description',
  'region',
]);

const PRODUCT_HEADER_ALIASES: Record<string, string> = {
  product: 'name',
  product_name: 'name',
  product_type: 'type',
  asset_type: 'type',
  abbreviation: 'abbr',
  symbol: 'abbr',
  minimum: 'minimum_investment',
  min_investment: 'minimum_investment',
  headline: 'metric',
  headline_figure: 'metric',
  headline_label: 'metric_label',
  risk_rating: 'risk',
  summary: 'description',
  market: 'region',
};

function canonicalHeader(value: string): string {
  const normalized = value
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return PRODUCT_HEADER_ALIASES[normalized] ?? normalized;
}

/** Major units typed by an operator → exact minor units sent to the API. */
export function majorAmountToMinor(major: string): { value?: string; error?: string } {
  const cleaned = major.replace(/[,\s]/g, '');
  if (cleaned === '') return { value: '0' };
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    return { error: 'must be a non-negative amount with up to 2 decimal places' };
  }
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const normalizedWhole = whole.replace(/^0+/, '') || '0';
  if (normalizedWhole.length > 19) {
    return { error: 'exceeds the supported amount range' };
  }
  const value = BigInt(normalizedWhole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (value > 9_223_372_036_854_775_807n) {
    return { error: 'exceeds the supported amount range' };
  }
  return { value: String(value) };
}

/** RFC-4180-style rows, plus tab-separated text copied from a spreadsheet. */
function delimitedRows(text: string): { rows: DelimitedRow[]; error?: string } {
  const firstBreak = text.search(/[\r\n]/);
  const firstLine = text.slice(0, firstBreak === -1 ? text.length : firstBreak);
  const delimiter = firstLine.includes('\t') && !firstLine.includes(',') ? '\t' : ',';
  const rows: DelimitedRow[] = [];
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\0') return { rows: [], error: 'The file contains an unsupported null byte.' };
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
        if (char === '\n') line += 1;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      cells.push(field);
      if (cells.some((cell) => cell.trim() !== '')) rows.push({ cells, line: rowLine });
      cells = [];
      field = '';
      line += 1;
      rowLine = line;
    } else {
      field += char;
    }
  }
  if (quoted) return { rows: [], error: `Line ${rowLine}: quoted value is not closed.` };
  cells.push(field);
  if (cells.some((cell) => cell.trim() !== '')) rows.push({ cells, line: rowLine });
  return { rows };
}

/**
 * Normalize a CSV/TSV import into the same contract the single-product form
 * sends. The server validates it again; this pass exists for a useful preview
 * and line-specific feedback, never as the security boundary.
 */
export function parseProductImport(text: string): ProductImportResult {
  if (new TextEncoder().encode(text).byteLength > PRODUCT_IMPORT_MAX_BYTES) {
    return { products: [], errors: ['The import must be 256 KB or smaller.'] };
  }
  const parsed = delimitedRows(text);
  if (parsed.error) return { products: [], errors: [parsed.error] };
  const [headerRow, ...dataRows] = parsed.rows;
  if (!headerRow) return { products: [], errors: ['Add a header row and at least one product.'] };

  const headers = headerRow.cells.map(canonicalHeader);
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const header of headers) {
    if (!PRODUCT_IMPORT_HEADERS.has(header)) errors.push(`Unknown column “${header}”.`);
    if (seen.has(header)) errors.push(`Column “${header}” appears more than once.`);
    seen.add(header);
  }
  for (const required of ['name', 'type', 'risk']) {
    if (!seen.has(required)) errors.push(`Missing required column “${required}”.`);
  }
  if (errors.length > 0) return { products: [], errors };
  if (dataRows.length > PRODUCT_IMPORT_MAX_ROWS) {
    return {
      products: [],
      errors: [`Import at most ${PRODUCT_IMPORT_MAX_ROWS} products at a time.`],
    };
  }

  const products: ProductInput[] = [];
  for (const row of dataRows) {
    if (row.cells.length > headers.length) {
      errors.push(`Line ${row.line}: has more values than the header row.`);
      continue;
    }
    const values = new Map(
      headers.map((header, index) => [header, row.cells[index]?.trim() ?? '']),
    );
    const value = (key: string) => values.get(key) ?? '';
    const name = value('name');
    const type = value('type')
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    const risk = value('risk').toLowerCase();
    const currency = (value('currency') || 'USD').toUpperCase();
    const minimum = majorAmountToMinor(value('minimum_investment'));
    const metric = value('metric');
    const metricLabel = value('metric_label');
    const lineErrors: string[] = [];

    if (name.length < 2 || name.length > 140) lineErrors.push('name must be 2–140 characters');
    if (!['bond', 'fund', 'equity', 'real_estate', 'private'].includes(type)) {
      lineErrors.push('type must be bond, fund, equity, real_estate or private');
    }
    if (!['low', 'medium', 'high'].includes(risk)) {
      lineErrors.push('risk must be low, medium or high');
    }
    if (!['USD', 'JMD', 'TTD', 'GYD', 'BBD', 'XCD', 'BSD'].includes(currency)) {
      lineErrors.push('currency is not supported');
    }
    if (minimum.error) lineErrors.push(`minimum investment ${minimum.error}`);
    if (Boolean(metric) !== Boolean(metricLabel)) {
      lineErrors.push('metric and metric_label must be supplied together');
    }
    const lengths: [string, string, number][] = [
      ['abbr', value('abbr'), 12],
      ['term', value('term'), 60],
      ['metric', metric, 60],
      ['metric_label', metricLabel, 60],
      ['description', value('description'), 2000],
      ['region', value('region'), 100],
    ];
    for (const [label, content, max] of lengths) {
      if (content.length > max) lineErrors.push(`${label} must be ${max} characters or fewer`);
    }
    if (lineErrors.length > 0) {
      errors.push(`Line ${row.line}: ${lineErrors.join('; ')}.`);
      continue;
    }

    products.push({
      name,
      type,
      risk: risk as ProductInput['risk'],
      currency,
      minInvestmentMinor: minimum.value ?? '0',
      ...(value('abbr') ? { abbr: value('abbr') } : {}),
      ...(value('term') ? { term: value('term') } : {}),
      ...(metric ? { metric } : {}),
      ...(metricLabel ? { metricLabel } : {}),
      ...(value('description') ? { description: value('description') } : {}),
      ...(value('region') ? { region: value('region') } : {}),
    });
  }
  if (dataRows.length === 0) errors.push('Add at least one product row below the headers.');
  return { products, errors };
}

/**
 * An accepted client is due periodic re-review after this many days — the
 * annual KYC refresh cadence a regulated book runs on. Computed from
 * `reviewed_at`, the date the firm actually decided, not from anything
 * invented.
 */
export const KYC_REVIEW_DUE_DAYS = 365;

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
  'funds.settled': 'Settled funds confirmed',
  'onboarding.document_uploaded': 'KYC document uploaded',
  'funding.declared': 'Client declared funds sent',
  'withdrawal.requested': 'Client requested a withdrawal',
  'withdrawal.paid': 'Withdrawal paid',
  'withdrawal.declined': 'Withdrawal declined',
  'agent.proposed': 'Agent proposed an investment',
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
  'partner.profile_updated': 'Firm corrected its own record',
  'webhook.configured': 'Audit-event webhook configured',
  'webhook.updated': 'Audit-event webhook updated',
  'webhook.enabled': 'Audit-event webhook enabled',
  'webhook.disabled': 'Audit-event webhook disabled',
  'webhook.secret_rotated': 'Webhook signing secret rotated',
  'webhook.test': 'Webhook test event queued',
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
  partner_webhook_endpoint: 'Audit-event webhook',
  reconciliation_items: 'Statement line',
  withdrawal_requests: 'Withdrawal',
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

/**
 * WHO did it, by name when the log knows one.
 *
 * `actor_id` has been on every audit row since the first migration and the
 * console never read it, so a desk's whole record of decisions was signed
 * "Operator" — which is no signature at all when three people share the desk.
 * The fallback is the actor-type word, never a guessed person.
 */
export function auditActorLine(a: { actorType: ConsoleActorType; actorName?: string | null }) {
  return a.actorName ?? AUDIT_ACTOR_LABEL[a.actorType];
}

/**
 * The audit actions that are somebody's DECISION — a person answerable for a
 * client's money or standing did something. What the "Decisions only" view
 * filters to: acceptance, KYC standing, money in, money out, executions.
 */
export const DECISION_ACTIONS = new Set([
  'client.accepted',
  'client.declined',
  'client.revoked',
  'client.reinstated',
  'funds.settled',
  'withdrawal.paid',
  'withdrawal.declined',
  'reconciliation.matched',
  'reconciliation.rejected',
  'order.accepted',
  'order.settled',
  'order.rejected',
  'partner.profile_updated',
]);

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
    typeof p.currency !== 'string' ||
    !(p.currency in CURRENCY_PREFIX)
  ) {
    return null;
  }
  return {
    name: p.name,
    valueMinor: p.valueMinor,
    // Safe: membership in CURRENCY_PREFIX is exactly what ConsoleCurrency means.
    currency: p.currency as ConsoleCurrency,
    returnLabel: typeof p.returnLabel === 'string' ? p.returnLabel : undefined,
  };
}
