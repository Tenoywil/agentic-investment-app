import { eq, inArray, sql } from 'drizzle-orm';
import { createDb } from './client';
import { seedDemoCustomer } from './demo/customer';
import {
  agentMessages,
  approvals,
  connectedAccounts,
  fxRates,
  goals,
  holdings,
  instruments,
  kycFunnelStages,
  kycStatus,
  limits,
  partnerKpis,
  partners,
  planningProducts,
  productListings,
  riskProfiles,
  user,
  userProfiles,
  userRoles,
} from './schema';

/**
 * Idempotent seed built from the prototype's domain model (index.html). Reference
 * and catalog rows upsert on their natural keys; the demo user's owned rows and
 * the anchor console's rows are reset-then-inserted so re-running is safe. Runs
 * as the privileged migration role (bypasses RLS). The append-only audit trail is
 * seeded only when the log is empty, since it cannot be deleted by design.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required to seed.');
  process.exit(1);
}

/** Dollars → integer minor units (USD cents). */
const usd = (dollars: number): bigint => BigInt(Math.round(dollars * 100));
const minToUsd = (s: string): bigint => usd(Number(s.replace(/[^0-9.]/g, '')));

const TYPE_MAP: Record<string, 'bond' | 'fund' | 'equity' | 'real_estate' | 'private'> = {
  Bond: 'bond',
  Fund: 'fund',
  Equity: 'equity',
  'Real Estate': 'real_estate',
  Private: 'private',
};
const RISK_MAP: Record<string, 'low' | 'medium' | 'high'> = {
  Low: 'low',
  Medium: 'medium',
  High: 'high',
};
const REG_MAP: Record<string, 'FSC_JAMAICA' | 'FSC_BARBADOS'> = {
  'FSC Jamaica': 'FSC_JAMAICA',
  'FSC Barbados': 'FSC_BARBADOS',
};
const codeFromPartnerName = (name: string): string => {
  if (/NCB/i.test(name)) return 'NCB';
  if (/Sagicor/i.test(name)) return 'SAG';
  if (/Proven/i.test(name)) return 'PRV';
  if (/JMMB/i.test(name)) return 'JMMB';
  if (/Barita/i.test(name)) return 'BAR';
  if (/Republic/i.test(name)) return 'REP';
  if (/Sygnus/i.test(name)) return 'SYG';
  return 'SAG';
};

// --- Reference data ---------------------------------------------------------

const PARTNERS = [
  {
    code: 'NCB' as const,
    name: 'National Commercial Bank',
    kind: 'Bank · Capital Markets',
    regulator: 'FSC_JAMAICA' as const,
    agreementStatus: 'prospect' as const,
    residency: 'Jamaica',
    color: '#1a4aa0',
    tint: '#e7edf8',
  },
  {
    code: 'SAG' as const,
    name: 'Sagicor Investments',
    kind: 'Funds · Insurance',
    regulator: 'FSC_JAMAICA' as const,
    agreementStatus: 'sandbox' as const,
    residency: 'Jamaica',
    color: '#1f7a44',
    tint: '#e6f2ea',
  }, // corridor-one anchor + console operator
  {
    code: 'PRV' as const,
    name: 'Proven Wealth',
    kind: 'Wealth Management',
    regulator: 'FSC_JAMAICA' as const,
    agreementStatus: 'prospect' as const,
    residency: 'Jamaica',
    color: '#9a6a1e',
    tint: '#f6efe0',
  },
  {
    code: 'JMMB' as const,
    name: 'JMMB Group',
    kind: 'Bank · Money Market',
    regulator: 'FSC_JAMAICA' as const,
    agreementStatus: 'prospect' as const,
    residency: 'Jamaica',
    color: '#c4362b',
    tint: '#fae8e6',
  },
  {
    code: 'BAR' as const,
    name: 'Barita Investments',
    kind: 'Broker · Investments',
    regulator: 'FSC_JAMAICA' as const,
    agreementStatus: 'prospect' as const,
    residency: 'Jamaica',
    color: '#6b4a9e',
    tint: '#f0eaf8',
  },
  {
    code: 'REP' as const,
    name: 'Republic Bank',
    kind: 'Bank · Treasury',
    regulator: 'FSC_BARBADOS' as const,
    agreementStatus: 'prospect' as const,
    residency: 'Barbados',
    color: '#1a6aa0',
    tint: '#e7f0f8',
  },
  {
    code: 'SYG' as const,
    name: 'Sygnus Capital',
    kind: 'Private credit',
    regulator: 'FSC_JAMAICA' as const,
    agreementStatus: 'prospect' as const,
    residency: 'Jamaica',
    color: '#8a5a2e',
    tint: '#f6eee2',
  },
  {
    code: 'GK' as const,
    name: 'GraceKennedy',
    kind: 'Issuer (distributed via Barita)',
    regulator: 'FSC_JAMAICA' as const,
    agreementStatus: 'prospect' as const,
    residency: 'Jamaica',
    color: '#0a7c53',
    tint: '#e2f4ea',
  },
];

// The nine marketplace opportunities, verbatim from index.html.
const OPPS = [
  {
    id: 'goj32',
    abbr: 'GOJ',
    type: 'Bond',
    partner: 'NCB Capital Markets',
    regulator: 'FSC Jamaica',
    name: 'Gov’t of Jamaica USD Global Bond 2032',
    region: 'Jamaica · Sovereign',
    metricLabel: 'Coupon',
    metric: '7.875%',
    min: 'US$1,000',
    term: '8 yr · USD',
    risk: 'Low',
    desc: 'A US-dollar sovereign bond issued by the Government of Jamaica, paying a fixed 7.875% semi-annual coupon. Suited to income-focused investors seeking hard-currency Caribbean sovereign exposure.',
    agentNote:
      'Strong fit for your income goal. Adds hard-currency duration and lifts blended yield without changing your risk band.',
    blocked: false,
    blockReasons: [] as string[],
  },
  {
    id: 'sagrex',
    abbr: 'REX',
    type: 'Real Estate',
    partner: 'Sagicor',
    regulator: 'FSC Jamaica',
    name: 'Sagicor Real Estate X Fund',
    region: 'Jamaica · Commercial property',
    metricLabel: 'Target return',
    metric: '9.2%',
    min: 'US$5,000',
    term: 'Open-ended',
    risk: 'Medium',
    desc: 'A diversified fund holding income-producing commercial real estate across Kingston and Montego Bay. Distributes quarterly with inflation-linked growth potential.',
    agentNote:
      'Matches your income + growth blend. I’d cap this at 15% of your portfolio to keep real-estate concentration in range.',
    blocked: false,
    blockReasons: [] as string[],
  },
  {
    id: 'gkapo',
    abbr: 'GK',
    type: 'Equity',
    partner: 'Barita Investments',
    regulator: 'FSC Jamaica',
    name: 'GraceKennedy Additional Public Offering',
    region: 'Jamaica · Consumer / Financial',
    metricLabel: 'Indicative yield',
    metric: '4.6%',
    min: 'US$500',
    term: 'Equity',
    risk: 'Medium',
    desc: 'An additional public offering of shares in GraceKennedy, one of the Caribbean’s largest consumer and financial conglomerates, funding regional expansion.',
    agentNote:
      'Adds equity growth you’re currently light on. Higher volatility than your bonds — sizing matters.',
    blocked: false,
    blockReasons: [] as string[],
  },
  {
    id: 'provfd',
    abbr: 'PWF',
    type: 'Fund',
    partner: 'Proven Wealth',
    regulator: 'FSC Jamaica',
    name: 'Proven USD Fixed Income Fund',
    region: 'Regional · Diversified credit',
    metricLabel: '12-mo yield',
    metric: '6.4%',
    min: 'US$1,000',
    term: 'Open-ended',
    risk: 'Low',
    desc: 'A professionally-managed USD fund investing in a diversified pool of regional corporate and sovereign credit, targeting stable monthly income.',
    agentNote:
      'You already hold this. Topping up would concentrate credit exposure — consider the GOJ bond instead for diversification.',
    blocked: false,
    blockReasons: [] as string[],
  },
  {
    id: 'bgtn29',
    abbr: 'BGB',
    type: 'Bond',
    partner: 'Republic Bank',
    regulator: 'FSC Barbados',
    name: 'Barbados Treasury Note 2029',
    region: 'Barbados · Sovereign',
    metricLabel: 'Coupon',
    metric: '6.25%',
    min: 'US$1,000',
    term: '5 yr',
    risk: 'Low',
    desc: 'A Barbadian government treasury note offering fixed semi-annual interest, providing geographic diversification within your sovereign allocation.',
    agentNote:
      'Good diversifier away from single-country Jamaica exposure. Slightly lower coupon than GOJ.',
    blocked: false,
    blockReasons: [] as string[],
  },
  {
    id: 'sygcr',
    abbr: 'SYG',
    type: 'Private',
    partner: 'Sygnus Capital',
    regulator: 'FSC Jamaica',
    name: 'Sygnus Private Credit Note III',
    region: 'Regional · Private credit',
    metricLabel: 'Target return',
    metric: '8.5%',
    min: 'US$10,000',
    term: '3 yr · locked',
    risk: 'High',
    desc: 'A private credit note providing senior secured financing to mid-market Caribbean firms. Higher return for reduced liquidity — capital is locked for the term.',
    agentNote:
      'Unlocked by your source-of-funds verification. Illiquid — only suitable for capital you won’t need for 3 years.',
    blocked: false,
    blockReasons: [] as string[],
  },
  {
    id: 'jmmb',
    abbr: 'JMB',
    type: 'Equity',
    partner: 'JMMB Group',
    regulator: 'FSC Jamaica',
    name: 'JMMB Group Rights Issue',
    region: 'Jamaica · Financial',
    metricLabel: 'Discount',
    metric: '12%',
    min: 'US$500',
    term: 'Equity',
    risk: 'Medium',
    desc: 'A rights issue allowing existing and new shareholders to buy JMMB shares at a discount to market, funding regional banking growth.',
    agentNote:
      'Time-sensitive — the rights window closes in 9 days. Discount is attractive but adds financial-sector concentration.',
    blocked: false,
    blockReasons: [] as string[],
  },
  {
    id: 'ncbmm',
    abbr: 'MMF',
    type: 'Fund',
    partner: 'NCB',
    regulator: 'FSC Jamaica',
    name: 'NCB USD Money Market Fund',
    region: 'Jamaica · Cash management',
    metricLabel: 'Current yield',
    metric: '5.1%',
    min: 'US$100',
    term: 'Instant access',
    risk: 'Low',
    desc: 'A liquid USD money-market fund for parking cash while earning yield, with same-day access. A natural home for your idle wallet balance.',
    agentNote:
      'Your US$2,150 cash is earning nothing. Moving it here adds ~US$110/yr with instant access.',
    blocked: false,
    blockReasons: [] as string[],
  },
  {
    id: 'slbd',
    abbr: 'BVD',
    type: 'Private',
    partner: 'Sygnus Capital',
    regulator: 'FSC Jamaica',
    name: 'Beachfront Villas Development Note',
    region: 'St. Lucia · Pre-construction real estate',
    metricLabel: 'Target return',
    metric: '14.0%',
    min: 'US$25,000',
    term: '5 yr · illiquid',
    risk: 'High',
    desc: 'A private note funding a pre-construction villa development. Returns depend entirely on construction milestones and unit sales. Capital is locked for the full term with no secondary market and no income until exit.',
    agentNote:
      'I recommend against this one for you, and I will not prepare it. It is listed so you can see exactly what I screen out and why.',
    blocked: true,
    blockReasons: [
      'High risk: your profile is balanced-income; this is a speculative development note',
      'Size: the US$25,000 minimum is 80% of your portfolio, far above your 15% single-position cap',
      'Liquidity: five years locked with no secondary market conflicts with your university-fund timeline',
      'Income: pays nothing until exit, while your stated goal is yield today',
    ],
  },
];

const PLANNING = [
  {
    code: 'LI',
    title: 'Life insurance',
    provider: 'Sagicor · Guardian Life',
    status: 'recommended' as const,
    accent: '#1f6f66',
    tint: '#e2f1ee',
    description: 'Term and whole-life cover to protect your family and estate.',
  },
  {
    code: 'RA',
    title: 'Retirement annuity',
    provider: 'NCB · JMMB',
    status: 'recommended' as const,
    accent: '#b0822e',
    tint: '#f6efdf',
    description: 'Tax-advantaged retirement savings with guaranteed income options.',
  },
  {
    code: 'CI',
    title: 'Health & critical illness',
    provider: 'Sagicor',
    status: 'available' as const,
    accent: '#0a8f5b',
    tint: '#e2f4ea',
    description: 'Cover for major medical events and critical illness diagnoses.',
  },
  {
    code: 'ES',
    title: 'Estate planning',
    provider: 'CCN Legal Network',
    status: 'explore' as const,
    accent: '#6b6459',
    tint: '#ece6da',
    description: 'Wills, trusts and cross-border estate structuring for the diaspora.',
  },
  {
    code: 'MG',
    title: 'Diaspora mortgage',
    provider: 'NCB · Republic Bank',
    status: 'available' as const,
    accent: '#1f6f66',
    tint: '#e2f1ee',
    description: 'Finance Caribbean property from abroad in hard currency.',
  },
  {
    code: 'ED',
    title: 'Education savings',
    provider: 'Sagicor',
    status: 'available' as const,
    accent: '#c56a3e',
    tint: '#f5e7d9',
    description: 'Goal-based saving toward tuition with projected funding paths.',
  },
];

const FX = [
  { quoteCurrency: 'USD' as const, rate: '1.000000' },
  { quoteCurrency: 'JMD' as const, rate: '157.200000' },
  { quoteCurrency: 'TTD' as const, rate: '6.790000' },
];

// --- Demo tenant ------------------------------------------------------------

const DEMO_EMAIL = 'marcus.bailey@ccn.demo';
const CLIENTS = [
  { email: 'client-4821@ccn.internal', ref: 'Client ••4821' },
  { email: 'client-7134@ccn.internal', ref: 'Client ••7134' },
  { email: 'client-2290@ccn.internal', ref: 'Client ••2290' },
  { email: 'client-5567@ccn.internal', ref: 'Client ••5567' },
];

async function main(): Promise<void> {
  const { db, close } = createDb(url as string, { max: 1 });
  try {
    // Reference / catalog (upsert on natural keys) ---------------------------
    // Partners are reference data whose only source is this array — nothing in
    // the product writes `kind`, `regulator`, `residency` or `agreement_status`.
    // `onConflictDoNothing` therefore froze whatever the FIRST seed contained:
    // a database seeded before these columns were filled in kept them NULL
    // forever, which on the console renders a partner with no line of business,
    // no regulator and no agreement chip, and never raises the sandbox badge.
    // Re-seeding must be able to correct reference data.
    await db
      .insert(partners)
      .values(PARTNERS)
      .onConflictDoUpdate({
        target: partners.code,
        set: {
          name: sql`excluded.name`,
          kind: sql`excluded.kind`,
          regulator: sql`excluded.regulator`,
          agreementStatus: sql`excluded.agreement_status`,
          residency: sql`excluded.residency`,
          color: sql`excluded.color`,
          tint: sql`excluded.tint`,
        },
      });
    await db
      .insert(planningProducts)
      .values(PLANNING)
      .onConflictDoNothing({ target: planningProducts.code });
    await db
      .insert(fxRates)
      .values(FX.map((f) => ({ baseCurrency: 'USD' as const, ...f })))
      .onConflictDoNothing({ target: [fxRates.baseCurrency, fxRates.quoteCurrency] });

    const partnerRows = await db.select({ id: partners.id, code: partners.code }).from(partners);
    const partnerIdByCode = new Map<string, string>(partnerRows.map((p) => [p.code, p.id]));

    await db
      .insert(instruments)
      .values(
        OPPS.map((o) => ({
          slug: o.id,
          abbr: o.abbr,
          type: TYPE_MAP[o.type] ?? 'fund',
          partnerId: partnerIdByCode.get(codeFromPartnerName(o.partner)) ?? null,
          regulator: REG_MAP[o.regulator] ?? null,
          name: o.name,
          region: o.region,
          metricLabel: o.metricLabel,
          metric: o.metric,
          minInvestmentMinor: minToUsd(o.min),
          term: o.term,
          risk: RISK_MAP[o.risk] ?? null,
          description: o.desc,
          agentNote: o.agentNote,
          blocked: o.blocked,
          blockReasons: o.blockReasons,
        })),
      )
      .onConflictDoNothing({ target: instruments.slug });

    const instrumentRows = await db
      .select({ id: instruments.id, slug: instruments.slug })
      .from(instruments);
    const instrumentIdBySlug = new Map(instrumentRows.map((i) => [i.slug, i.id]));
    const sag = partnerIdByCode.get('SAG');
    if (!sag) throw new Error('anchor partner SAG missing after seed');

    // Users (upsert on email) ------------------------------------------------
    await db
      .insert(user)
      .values([
        { name: 'Marcus A. Bailey', email: DEMO_EMAIL, emailVerified: true },
        ...CLIENTS.map((c) => ({ name: c.ref, email: c.email, emailVerified: true })),
      ])
      .onConflictDoNothing({ target: user.email });

    const userRows = await db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.email, [DEMO_EMAIL, ...CLIENTS.map((c) => c.email)]));
    const userIdByEmail = new Map(userRows.map((u) => [u.email, u.id]));
    const demoId = userIdByEmail.get(DEMO_EMAIL);
    if (!demoId) throw new Error('demo user missing after seed');

    // The demo customer's whole account, from the one definition that runtime
    // provisioning also uses (see packages/db/src/demo/customer.ts).
    await seedDemoCustomer(db, demoId);
    await db.insert(userRoles).values({ userId: demoId, role: 'customer' }).onConflictDoNothing();

    // Anchor (SAG) console: reset-then-insert -------------------------------
    await db.delete(productListings).where(eq(productListings.partnerId, sag));
    await db.delete(partnerKpis).where(eq(partnerKpis.partnerId, sag));
    await db.delete(kycFunnelStages).where(eq(kycFunnelStages.partnerId, sag));

    // Which products the partner has listed — real configuration, and the
    // subject of the live/paused toggle.
    //
    // Their per-product `clients`, `aum_minor` and `trend` are deliberately not
    // seeded. CCN does not compute any of them: there is no attribution model
    // behind "412 clients", no AUM roll-up behind "US$14.2M" and no series
    // behind "+22%". They were the prototype's inventions sitting in a
    // production table, which made them read as the most trustworthy figures on
    // the console. The columns are NOT NULL with a 0 default (changing that
    // needs a migration), so the API simply does not return them and the UI has
    // no column to render — a zero standing in for unknown is the same lie in
    // quieter clothing.
    await db.insert(productListings).values([
      { partnerId: sag, name: 'GOJ USD Global Bond 2032', type: 'Bond' },
      { partnerId: sag, name: 'Sagicor Real Estate X Fund', type: 'Real Estate' },
      { partnerId: sag, name: 'Proven USD Income Fund', type: 'Fund' },
      { partnerId: sag, name: 'NCB Money Market Fund', type: 'Money Market' },
      { partnerId: sag, name: 'Sygnus Private Credit III', type: 'Private' },
    ]);

    // `partner_kpis` and `kyc_funnel_stages` are intentionally left empty.
    //
    // They used to carry "Referred AUM US$48.2M", "New clients (MTD) 1,284",
    // "Onboarding conversion 71%", "CAC vs. direct −41%" and a 4,120 → 1,284
    // funnel. Not one of those is measured anywhere in this system; they were
    // invented for the prototype and then seeded into the real database, where
    // being API-backed made them look like the most authoritative numbers on
    // screen. The console renders its empty states for both panels instead, and
    // its metrics row still shows real pending/settled order counts computed
    // from the orders table. Both tables stay — the surface is right, the
    // numbers just have to be earned.

    // Console orders (via the create_order choke point) + transitions --------
    const orderSpecs = [
      {
        email: CLIENTS[0]?.email,
        ref: CLIENTS[0]?.ref,
        slug: 'sagrex',
        amount: 5000,
        key: 'seed-o1',
        to: 'created' as const,
      },
      {
        email: CLIENTS[1]?.email,
        ref: CLIENTS[1]?.ref,
        slug: 'goj32',
        amount: 2000,
        key: 'seed-o2',
        to: 'created' as const,
      },
      {
        email: CLIENTS[2]?.email,
        ref: CLIENTS[2]?.ref,
        slug: null,
        amount: 3500,
        key: 'seed-o3',
        to: 'accepted' as const,
      },
      {
        email: CLIENTS[3]?.email,
        ref: CLIENTS[3]?.ref,
        slug: 'provfd',
        amount: 10000,
        key: 'seed-o4',
        to: 'settled' as const,
      },
    ];
    for (const o of orderSpecs) {
      const clientId = o.email ? userIdByEmail.get(o.email) : undefined;
      if (!clientId) continue;
      const created = await db.execute(sql`
        select id from create_order(
          ${clientId}::uuid, ${sag}::uuid, ${o.slug ? (instrumentIdBySlug.get(o.slug) ?? null) : null}::uuid,
          null::uuid, ${usd(o.amount)}::bigint, 'USD'::currency, ${o.key}::text, ${o.ref ?? null}::text, 'agent'::actor_type)
      `);
      const orderId = (created as unknown as Array<{ id: string }>)[0]?.id;
      if (!orderId) continue; // idempotent replay returns the existing row too, but guard anyway
      if (o.to === 'accepted' || o.to === 'settled') {
        await db
          .execute(sql`select id from accept_order(${orderId}::uuid, ${sag}::uuid)`)
          .catch(() => {});
      }
      if (o.to === 'settled') {
        await db
          .execute(sql`select id from settle_order(${orderId}::uuid, ${sag}::uuid)`)
          .catch(() => {});
      }
    }

    console.log('✓ seed complete');
  } finally {
    await close();
  }
}

await main();
