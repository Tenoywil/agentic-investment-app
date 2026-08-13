import type { Surface } from '@/lib/me-api';

/**
 * What a first-time viewer is walked through, per surface.
 *
 * Each step names a `data-tour` attribute that the screen owns. A step whose
 * element is not on the page is dropped at runtime rather than rendered against
 * nothing — screens differ by account state (a brand-new customer has no
 * approvals card to point at), and a tour that stalls on an empty account is
 * worse than a shorter one.
 *
 * Copy rule: describe what the user can *do*, and never assert a number. These
 * strings are shipped text like any other, and the same no-fabrication rule
 * applies to them.
 */

export interface TourStep {
  /** The `data-tour` value on the element to highlight. */
  target: string;
  title: string;
  body: string;
}

const CUSTOMER: TourStep[] = [
  {
    target: 'customer-net-worth',
    title: 'Everything you own, in one place',
    body: 'Holdings from every institution you have linked, converted into a single currency. Switch currency here and the whole page follows.',
  },
  {
    target: 'customer-nav',
    title: 'Your workspace',
    body: 'Portfolio, opportunities, your agent and your plan. Everything you see is your own data — nothing here is a sample.',
  },
  {
    target: 'customer-agent',
    title: 'The agent proposes; you decide',
    body: 'Ask it to research, compare or plan. It can never move your money on its own — anything with a consequence comes back to you as an approval.',
  },
  {
    target: 'customer-limits',
    title: 'Your guardrails',
    body: 'The limits the agent must work inside. Change them here and the server enforces the new values immediately.',
  },
  {
    target: 'customer-approvals',
    title: 'Nothing happens without this step',
    body: 'Every proposed action waits here for you. Approve it and a licensed partner executes; ignore it and it expires.',
  },
  {
    target: 'customer-opportunities',
    title: 'Products from licensed partners',
    body: 'Regional instruments you can act on, each one carrying the institution that issues it and the regulator that supervises them.',
  },
];

const INSTITUTION: TourStep[] = [
  {
    target: 'institution-identity',
    title: 'You are signed in as your institution',
    body: 'Everything on this console is scoped to your firm. You cannot see another partner’s clients, orders or documents, and neither can they see yours.',
  },
  {
    target: 'institution-sections',
    title: 'The console',
    body: 'Overview, clients, products, orders and compliance. Each one reads live from your own records.',
  },
  {
    target: 'institution-kpis',
    title: 'Your referred business',
    body: 'Volume and client counts attributed to your institution.',
  },
  {
    target: 'institution-funnel',
    title: 'Where onboarding stalls',
    body: 'Each stage a referred client passes through, so you can see which step is losing them.',
  },
  {
    target: 'institution-products',
    title: 'What you have listed',
    body: 'The products CCN can present to investors on your behalf, and their current state.',
  },
  {
    target: 'institution-orders',
    title: 'Orders awaiting you',
    body: 'Investor-approved orders routed to your desk. Accepting one moves it into settlement.',
  },
  {
    target: 'institution-audit',
    title: 'An audit trail you cannot edit',
    body: 'Every action is appended here and nothing can rewrite it — the database rejects updates and deletes on this table outright.',
  },
  {
    target: 'institution-signout',
    title: 'One identity, one surface',
    body: 'An institution login reaches the console and nothing else. To use CCN as an investor, sign out and sign in with an investor account.',
  },
];

export function stepsFor(surface: Surface): TourStep[] {
  return surface === 'institution' ? INSTITUTION : CUSTOMER;
}
