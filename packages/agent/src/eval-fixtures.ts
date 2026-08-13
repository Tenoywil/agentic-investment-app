import type { EngineLimits } from '@ccn/limits-engine';
import type { AgentSnapshot, SnapshotInstrument } from './snapshot';

/**
 * Golden fixture for the agent-eval suite — a Marcus-like balanced-income
 * (high_moderate) investor with US$8,000 idle cash. Not a test file; imported by
 * the eval tests.
 */

const LIMITS: EngineLimits = {
  autoInvestCapMinor: 50_000n, // US$500
  autoInvestEnabled: true,
  cashFloorMinor: 100_000n, // US$1,000
  cashFloorEnabled: true,
  fxSpreadMaxBps: 30,
  fxSpreadEnabled: true,
  requireApprovalAboveMinor: 100_000n, // US$1,000
  requireApprovalEnabled: true,
  singlePositionMaxPct: 15,
  singlePositionEnabled: true,
  dailyCapMinor: null,
  dailyCapEnabled: false,
};

const inst = (
  over: Partial<SnapshotInstrument> &
    Pick<SnapshotInstrument, 'id' | 'slug' | 'type' | 'name' | 'risk'>,
): SnapshotInstrument => ({
  abbr: over.id.slice(0, 3).toUpperCase(),
  region: null,
  metricLabel: null,
  metric: null,
  minInvestmentMinor: 10_000n,
  currency: 'USD',
  blocked: false,
  blockReasons: [],
  partnerName: 'NCB',
  regulator: 'FSC Jamaica',
  ...over,
});

export function sampleSnapshot(): AgentSnapshot {
  return {
    portfolio: {
      currency: 'USD',
      netWorthMinor: 2_860_000n, // US$28,600 (cash + sigma + a bond)
      cashMinor: 800_000n, // US$8,000
      spentTodayMinor: 0n,
      positions: [{ instrumentId: 'sig', valueMinor: 820_000n }],
      holdings: [
        { name: 'USD Chequing', valueMinor: 800_000n, partner: 'NCB' },
        { name: 'Sigma Global Fund', valueMinor: 820_000n, partner: 'SAG' },
        { name: 'GOJ Bond 2029', valueMinor: 1_240_000n, partner: 'NCB' },
      ],
    },
    limits: LIMITS,
    band: 'high_moderate',
    instruments: [
      inst({
        id: 'mmf',
        slug: 'ncbmm',
        type: 'fund',
        name: 'NCB USD Money Market Fund',
        risk: 'low',
        region: 'Jamaica · Cash management',
        metricLabel: 'Current yield',
        metric: '5.1%',
        minInvestmentMinor: 10_000n,
      }),
      inst({
        id: 'goj',
        slug: 'goj32',
        type: 'bond',
        name: 'Gov’t of Jamaica USD Global Bond 2032',
        risk: 'low',
        region: 'Jamaica · Sovereign',
        metricLabel: 'Coupon',
        metric: '7.875%',
        minInvestmentMinor: 100_000n,
      }),
      inst({
        id: 'sig',
        slug: 'sagrex',
        type: 'real_estate',
        name: 'Sagicor Real Estate X Fund',
        risk: 'medium',
        region: 'Jamaica · Commercial property',
        minInvestmentMinor: 500_000n,
        partnerName: 'Sagicor',
      }),
      inst({
        id: 'syg',
        slug: 'sygcr',
        type: 'private',
        name: 'Sygnus Private Credit Note III',
        risk: 'high',
        region: 'Regional · Private credit',
        minInvestmentMinor: 1_000_000n,
        partnerName: 'Sygnus',
      }),
      inst({
        id: 'villa',
        slug: 'slbd',
        type: 'private',
        name: 'Beachfront Villas Development Note',
        risk: 'high',
        region: 'St. Lucia · Pre-construction',
        minInvestmentMinor: 2_500_000n,
        partnerName: 'Sygnus',
        blocked: true,
        blockReasons: [
          'High risk: your profile is balanced-income; this is a speculative development note',
          'Size: the US$25,000 minimum is 80% of your portfolio, above your 15% single-position cap',
          'Liquidity: five years locked with no secondary market',
          'Income: pays nothing until exit, while your goal is yield today',
        ],
      }),
    ],
  };
}
