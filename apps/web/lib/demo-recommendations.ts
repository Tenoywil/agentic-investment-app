import {
  DEFAULT_DEMO_PROFILE,
  type DemoProfile,
  rankDemoMatches,
} from '@/app/_components/AppScreen';

type Kind = 'Bond' | 'Fund' | 'Equity' | 'Real Estate' | 'Private';

export const BLUE_MAHOE_PARTNER_NAME = 'Blue Mahoe Capital (Guyana)';

export const DEMO_REFERENCE_PROFILE: DemoProfile = {
  ...DEFAULT_DEMO_PROFILE,
  name: 'Jevon',
  risk: 'Growth',
  objective: 'Growth',
  horizon: '5–10 years',
  liquidity: 'Can lock for 5 years',
};

export type DemoOpportunity = {
  id: string;
  abbr: string;
  type: Kind;
  partner: string;
  regulator: string;
  name: string;
  region: string;
  metricLabel: string;
  metric: string;
  min: string;
  term: string;
  risk: 'Low' | 'Medium' | 'High';
  match: number;
  desc: string;
  agentNote: string;
  totalReturn?: number;
  lockYears?: number;
  gdpGrowth?: string;
  keyRisk?: string;
  blocked?: boolean;
  blockReasons?: string[];
};

const FEEDBACK_MATCHES: DemoOpportunity[] = [
  {
    id: 'blue-mahoe-feedback',
    abbr: 'BMC',
    type: 'Equity',
    partner: BLUE_MAHOE_PARTNER_NAME,
    regulator: 'Partner review required',
    name: BLUE_MAHOE_PARTNER_NAME,
    region: 'Guyana',
    metricLabel: 'Expected growth over 5 years',
    metric: '12.5%',
    min: 'US$1,000',
    term: '5 yr',
    risk: 'High',
    match: 99,
    desc: 'Illustrative five-year growth opportunity from the feedback scenario. The return is an estimate, not a guarantee or an annualized rate.',
    agentNote:
      'Within the example investor’s 5–15% return target and five-year horizon. High risk tolerance does not remove the need to investigate land ownership.',
    totalReturn: 12.5,
    lockYears: 5,
    gdpGrowth: '16.2%',
    keyRisk: 'Land ownership disputes could affect the investment.',
  },
  {
    id: 'ncb-feedback',
    abbr: 'NCB',
    type: 'Equity',
    partner: 'NCB Capital Markets',
    regulator: 'Partner review required',
    name: 'NCB Capital Markets',
    region: 'Jamaica',
    metricLabel: 'Expected growth over 5 years',
    metric: '10.2%',
    min: 'US$5,000',
    term: '5 yr',
    risk: 'High',
    match: 92,
    desc: 'Illustrative five-year growth opportunity from the feedback scenario. The example minimum investment is US$5,000.',
    agentNote:
      'Within the example investor’s 5–15% return target and five-year horizon. Review reporting timeliness and the potential effect of a trading suspension.',
    totalReturn: 10.2,
    lockYears: 5,
    gdpGrowth: '1%',
    keyRisk:
      'Late mandatory audited financial reports by underlying companies may lead to trading suspensions.',
  },
];

const OTHER_OPPORTUNITIES: DemoOpportunity[] = [
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
    match: 88,
    desc: 'A US-dollar sovereign bond issued by the Government of Jamaica, paying a fixed 7.875% semi-annual coupon. Suited to income-focused investors seeking hard-currency Caribbean sovereign exposure.',
    agentNote:
      'Strong fit for your income goal. Adds hard-currency duration and lifts blended yield without changing your risk band.',
  },
  {
    id: 'sagrex',
    abbr: 'REX',
    type: 'Real Estate',
    partner: 'Sagicor Investments',
    regulator: 'FSC Jamaica',
    name: 'Sagicor Real Estate X Fund',
    region: 'Jamaica · Commercial property',
    metricLabel: 'Target return',
    metric: '9.2%',
    min: 'US$5,000',
    term: 'Open-ended',
    risk: 'Medium',
    match: 89,
    desc: 'A diversified fund holding income-producing commercial real estate across Kingston and Montego Bay. Distributes quarterly with inflation-linked growth potential.',
    agentNote:
      'Matches your income and growth blend. I’d cap this at 15% of your portfolio to keep real-estate concentration in range.',
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
    match: 84,
    desc: 'An additional public offering of shares in GraceKennedy, one of the Caribbean’s largest consumer and financial conglomerates, funding regional expansion.',
    agentNote:
      'Adds equity growth you’re currently light on. Higher volatility than your bonds, so sizing matters.',
  },
  {
    id: 'provfd',
    abbr: 'PWF',
    type: 'Fund',
    partner: 'PROVEN Wealth',
    regulator: 'FSC Jamaica',
    name: 'Proven USD Fixed Income Fund',
    region: 'Regional · Diversified credit',
    metricLabel: '12-mo yield',
    metric: '6.4%',
    min: 'US$1,000',
    term: 'Open-ended',
    risk: 'Low',
    match: 78,
    desc: 'A professionally-managed USD fund investing in a diversified pool of regional corporate and sovereign credit, targeting stable monthly income.',
    agentNote:
      'You already hold this. Topping up would concentrate credit exposure. Consider the GOJ bond instead for diversification.',
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
    match: 76,
    desc: 'A Barbadian government treasury note offering fixed semi-annual interest, providing geographic diversification within your sovereign allocation.',
    agentNote:
      'Good diversifier away from single-country Jamaica exposure. Slightly lower coupon than GOJ.',
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
    match: 72,
    desc: 'A private credit note providing senior secured financing to mid-market Caribbean firms. Higher return for reduced liquidity: capital is locked for the term.',
    agentNote:
      'Unlocked by your source-of-funds declaration. Illiquid, and only suitable for capital you won’t need for 3 years.',
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
    match: 68,
    desc: 'A rights issue allowing existing and new shareholders to buy JMMB shares at a discount to market, funding regional banking growth.',
    agentNote:
      'Time-sensitive: the rights window closes in 9 days. Discount is attractive but adds financial-sector concentration.',
  },
  {
    id: 'ncbmm',
    abbr: 'MMF',
    type: 'Fund',
    partner: 'NCB Capital Markets',
    regulator: 'FSC Jamaica',
    name: 'NCB USD Money Market Fund',
    region: 'Jamaica · Cash management',
    metricLabel: 'Current yield',
    metric: '5.1%',
    min: 'US$100',
    term: 'Instant access',
    risk: 'Low',
    match: 65,
    desc: 'A liquid USD money-market fund for parking cash while earning yield, with same-day access. A natural home for your idle wallet balance.',
    agentNote:
      'Your US$2,150 cash is earning nothing. Moving it here adds ~US$110/yr with instant access.',
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
    match: 18,
    blocked: true,
    desc: 'A private note funding a pre-construction villa development. Returns depend entirely on construction milestones and unit sales. Capital is locked for the full term with no secondary market and no income until exit.',
    agentNote:
      'I recommend against this one for you, and I will not prepare it. It is listed so you can see exactly what I screen out and why.',
    blockReasons: [
      'High risk: your profile is balanced-income; this is a speculative development note',
      'Size: the US$25,000 minimum is 80% of your portfolio, far above your 15% single-position cap',
      'Liquidity: five years locked with no secondary market conflicts with your university-fund timeline',
      'Income: pays nothing until exit, while your stated goal is yield today',
    ],
  },
];

export const DEMO_OPPORTUNITIES = [...FEEDBACK_MATCHES, ...OTHER_OPPORTUNITIES];

/** Scores are illustrative, calibrated to the reference scenario, then adjusted
 * by the same deterministic suitability rules for each saved profile. */
export function rankDemoRecommendations(profile: DemoProfile): DemoOpportunity[] {
  const available = DEMO_OPPORTUNITIES.filter((opportunity) => !opportunity.blocked);
  const referenceScores = new Map(
    rankDemoMatches(
      available.map((opportunity) => ({ ...opportunity, match: 50 })),
      DEMO_REFERENCE_PROFILE,
    ).map((opportunity) => [opportunity.id, opportunity.match]),
  );
  const profileScores = rankDemoMatches(
    available.map((opportunity) => ({ ...opportunity, match: 50 })),
    profile,
  );
  return profileScores
    .map((scored) => {
      const opportunity = available.find((candidate) => candidate.id === scored.id);
      if (!opportunity) throw new Error('Unknown demo opportunity');
      const targetBounds = profile.targetReturn.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      const targetMinimum = targetBounds[0];
      const targetMaximum = targetBounds[1];
      const outsideTarget =
        opportunity.totalReturn !== undefined &&
        targetMinimum !== undefined &&
        targetMaximum !== undefined &&
        (opportunity.totalReturn < targetMinimum || opportunity.totalReturn > targetMaximum);
      const targetPenalty = outsideTarget ? 10 : 0;
      const lockTolerance =
        profile.liquidity === 'Can lock for 5 years'
          ? 5
          : profile.liquidity === 'Can lock for 3 years'
            ? 3
            : 0;
      const liquidityPenalty =
        opportunity.lockYears && opportunity.lockYears > lockTolerance ? 12 : 0;
      const adjustment = scored.match - (referenceScores.get(scored.id) ?? 50);
      const fitNote =
        opportunity.totalReturn === undefined
          ? opportunity.agentNote
          : `${opportunity.metric} estimated total growth over five years ${outsideTarget ? 'falls outside' : 'fits'} your ${profile.targetReturn} target. ${liquidityPenalty ? 'The five-year commitment exceeds your access preference. ' : ''}${opportunity.keyRisk}`;
      return {
        ...opportunity,
        agentNote: fitNote,
        match: Math.max(
          1,
          Math.min(99, opportunity.match + adjustment - targetPenalty - liquidityPenalty),
        ),
      };
    })
    .sort((a, b) => b.match - a.match);
}

/** The walkthrough always leads with the requested Blue Mahoe scenario while
 * the remaining slots keep the strongest profile-ranked comparisons. The fit
 * calculation and explanation remain profile-driven; the displayed percentage
 * keeps Blue Mahoe strictly above the other recommendations for this scenario. */
export function selectDemoRecommendations(profile: DemoProfile, limit = 2): DemoOpportunity[] {
  if (limit <= 0) return [];
  const ranked = rankDemoRecommendations(profile);
  const blueMahoe = ranked.find((opportunity) => opportunity.partner === BLUE_MAHOE_PARTNER_NAME);
  if (!blueMahoe) return ranked.slice(0, limit);
  const comparisons = ranked
    .filter((opportunity) => opportunity.id !== blueMahoe.id)
    .slice(0, Math.max(0, limit - 1));
  const highestComparison = Math.max(0, ...comparisons.map(({ match }) => match));
  const blueMahoeMatch = Math.min(99, Math.max(blueMahoe.match, highestComparison + 1));
  return [
    { ...blueMahoe, match: blueMahoeMatch },
    ...comparisons.map((opportunity) => ({
      ...opportunity,
      match: Math.min(opportunity.match, blueMahoeMatch - 1),
    })),
  ];
}
