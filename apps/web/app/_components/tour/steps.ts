import type { Surface } from '@/lib/me-api';

export type TourSurface = Surface | 'demo-customer' | 'demo-institution';

export interface TourStep {
  target: string;
  title: string;
  body: string;
}

const CUSTOMER_NAV: TourStep = {
  target: 'customer-nav',
  title: 'Your workspace',
  body: 'Move between your portfolio, investments, orders, planning and agent. Private-market work has its own section.',
};

const CUSTOMER_ROUTES: Record<string, TourStep[]> = {
  '/home': [
    {
      target: 'customer-net-worth',
      title: 'Your position at a glance',
      body: 'See the value held across connected institutions in your preferred currency.',
    },
    {
      target: 'customer-agent',
      title: 'Decisions come back to you',
      body: 'The agent can research and prepare work. Anything consequential waits for your approval.',
    },
    {
      target: 'customer-approvals',
      title: 'Review before anything happens',
      body: 'Open a proposed action to inspect the amount, rationale, limits check and execution partner.',
    },
    {
      target: 'customer-activity',
      title: 'A clear activity record',
      body: 'Recent research and actions are recorded here so you can see what changed and why.',
    },
  ],
  '/portfolio': [
    {
      target: 'customer-portfolio-page',
      title: 'Your holdings across firms',
      body: 'Balances stay with each licensed institution. CCN combines the view without holding your money.',
    },
    {
      target: 'customer-portfolio-accounts',
      title: 'Work with one institution',
      body: 'Pull statements, submit transfer evidence or request a withdrawal from the relevant account card.',
    },
    {
      target: 'customer-portfolio-funding',
      title: 'Prove a transfer safely',
      body: 'Enter a transaction reference or attach a receipt. The partner still verifies the transfer before crediting cash.',
    },
    {
      target: 'customer-portfolio-connect',
      title: 'Connect another institution',
      body: 'Only institutions with no active or pending relationship appear in the connection flow.',
    },
  ],
  '/opportunities': [
    {
      target: 'customer-marketplace',
      title: 'Compare available investments',
      body: 'Filter products listed by partner institutions, then open one to review terms, risk and suitability.',
    },
  ],
  '/orders': [
    {
      target: 'customer-order-flow',
      title: 'Follow every order',
      body: 'Track when a partner accepts, settles or declines an order. Settled orders include a contract note.',
    },
  ],
  '/agent': [
    {
      target: 'customer-agent',
      title: 'Ask, compare and explore',
      body: 'The conversation supports prose, lists, tables and purpose-built data views when each is useful.',
    },
    {
      target: 'customer-approvals',
      title: 'Your approval queue',
      body: 'Prepared moves wait here. Review the evidence and decide without the agent acting through the tour.',
    },
    {
      target: 'customer-limits',
      title: 'Deterministic guardrails',
      body: 'Your limits are enforced by the server. The agent cannot override them.',
    },
  ],
  '/planning': [
    {
      target: 'customer-planning',
      title: 'Turn goals into a plan',
      body: 'Review projections, contribution paths and goal progress using your current portfolio data.',
    },
  ],
  '/gateway/mandate': [
    {
      target: 'gateway-mandate-form',
      title: 'Describe your private-market mandate',
      body: 'Start in your own words, then review every structured field before it is saved.',
    },
    {
      target: 'gateway-mandate-summary',
      title: 'See what matching uses',
      body: 'Cheque range, horizon, target, risk, geography, sector and stage are visible in one screening brief.',
    },
    {
      target: 'gateway-mandate-process',
      title: 'A safe three-step path',
      body: 'Describe, review and match. A mandate does not invest or contact an issuer.',
    },
  ],
  '/gateway/opportunities': [
    {
      target: 'gateway-deals',
      title: 'Deals ranked to your mandate',
      body: 'Fit reasons and conflicts sit beside each opportunity so a high score never hides the trade-offs.',
    },
  ],
  '/gateway/introductions': [
    {
      target: 'gateway-introductions',
      title: 'Manage private-deal introductions',
      body: 'Track who received a request and what happens next without presenting an introduction as an investment.',
    },
  ],
  '/gateway/review': [
    {
      target: 'gateway-review',
      title: 'Independent review queue',
      body: 'Analysts and compliance reviewers can inspect private-market evidence and decisions in one place.',
    },
  ],
};

const INSTITUTION: TourStep[] = [
  {
    target: 'institution-identity',
    title: 'Your institution',
    body: 'The console is scoped to this firm and its authorised operators.',
  },
  {
    target: 'institution-sections',
    title: 'The operating desk',
    body: 'Move between overview, order flow, products, clients and compliance.',
  },
  {
    target: 'institution-checklist',
    title: 'Complete the desk setup',
    body: 'Funding instructions, products, clients and orders form a practical readiness checklist.',
  },
  {
    target: 'institution-needs-you',
    title: 'What needs action',
    body: 'See orders, client reviews, reconciliation items and withdrawals waiting for your firm.',
  },
  {
    target: 'institution-kpis',
    title: 'Referred business',
    body: 'Review live volume and client measures attributed to your institution.',
  },
  {
    target: 'institution-funnel',
    title: 'Client onboarding',
    body: 'See where referred clients progress or stall, then open a person for the underlying KYC record.',
  },
  {
    target: 'institution-clients',
    title: 'Clients and KYC',
    body: 'Accept, decline or request more information using the verified record available to your desk.',
  },
  {
    target: 'institution-products',
    title: 'Your listed products',
    body: 'Publish complete product data and pause a listing when it should leave the marketplace.',
  },
  {
    target: 'institution-orders',
    title: 'Order execution',
    body: 'Accept with a settlement date, then record the actual price, units, fee and reference.',
  },
  {
    target: 'institution-withdrawals',
    title: 'Withdrawal decisions',
    body: 'Record payment or decline with a reason the client can see.',
  },
  {
    target: 'institution-decisions',
    title: 'Signed decisions',
    body: 'Filter the audit trail to the people and decisions that changed client state.',
  },
  {
    target: 'institution-audit',
    title: 'Append-only audit trail',
    body: 'Review and export the event record used for compliance oversight.',
  },
  {
    target: 'institution-signout',
    title: 'One identity, one surface',
    body: 'Sign out before moving between institution and investor identities.',
  },
];

const DEMO_INSTITUTION: TourStep[] = [
  {
    target: 'demo-institution-shell',
    title: 'Fixture-only partner console',
    body: 'Explore seeded products, clients, orders and compliance records. Actions stay inside this browser preview.',
  },
];

function routeKey(pathname: string): string {
  const withoutDemo = pathname.startsWith('/demo/') ? pathname.slice('/demo'.length) : pathname;
  const match = Object.keys(CUSTOMER_ROUTES)
    .sort((a, b) => b.length - a.length)
    .find((key) => withoutDemo === key || withoutDemo.startsWith(`${key}/`));
  return match ?? '/home';
}

export function stepsFor(surface: TourSurface, pathname: string): TourStep[] {
  if (surface === 'institution') return INSTITUTION;
  if (surface === 'demo-institution') return DEMO_INSTITUTION;
  return [CUSTOMER_NAV, ...(CUSTOMER_ROUTES[routeKey(pathname)] ?? [])];
}
