import type { RiskBand } from './suitability';

/**
 * The target portfolio mix per suitability band — the policy answer to "what
 * combination of assets should this person end up holding?"
 *
 * One reviewable table, in whole percentage points, summing to 100 per band
 * (unit-tested). This is deliberately NOT a model output: the combination a
 * person is steered toward is a compliance-reviewable policy, so it lives
 * here as data the fit agent and the allocation view both read. The agent
 * proposes single moves that close the largest gap between a person's actual
 * mix and their band's target — assembling the combination one approved step
 * at a time, never as a bulk reallocation nobody asked for.
 *
 * Keys are the `instrument_type` enum plus `cash`.
 */
export type MixKey = 'cash' | 'bond' | 'fund' | 'equity' | 'real_estate' | 'private';

export type TargetMix = Record<MixKey, number>;

export const TARGET_MIX: Record<RiskBand, TargetMix> = {
  low: { cash: 20, bond: 50, fund: 25, equity: 5, real_estate: 0, private: 0 },
  low_moderate: { cash: 15, bond: 40, fund: 30, equity: 10, real_estate: 5, private: 0 },
  high_moderate: { cash: 10, bond: 30, fund: 30, equity: 15, real_estate: 10, private: 5 },
  low_high: { cash: 10, bond: 20, fund: 30, equity: 20, real_estate: 12, private: 8 },
  high: { cash: 5, bond: 10, fund: 25, equity: 30, real_estate: 15, private: 15 },
};

export const MIX_KEYS: readonly MixKey[] = [
  'cash',
  'bond',
  'fund',
  'equity',
  'real_estate',
  'private',
];

/** The band's target mix. Total is asserted in tests, not trusted at runtime. */
export function targetMixFor(band: RiskBand): TargetMix {
  return TARGET_MIX[band];
}

/** Normalize an instrument-type label onto a mix key; unknown types count as
 *  nothing rather than silently inflating a bucket. */
export function mixKeyFor(type: string | null): MixKey | null {
  if (type === null) return 'cash';
  const key = type.toLowerCase() as MixKey;
  return MIX_KEYS.includes(key) ? key : null;
}

export interface AllocationGap {
  key: MixKey;
  /** Percentage points below (+) or above (−) the band target. */
  gapPts: number;
}

/**
 * Where the actual mix sits against the band's target, largest shortfall
 * first. `currentPct` is the actual mix in percentage points (missing keys
 * count as 0). Pure arithmetic — the caller computes the actual mix from
 * real holdings.
 */
export function allocationGaps(
  currentPct: Partial<Record<MixKey, number>>,
  band: RiskBand,
): AllocationGap[] {
  const target = targetMixFor(band);
  return MIX_KEYS.map((key) => ({
    key,
    gapPts: Math.round((target[key] - (currentPct[key] ?? 0)) * 10) / 10,
  })).sort((a, b) => b.gapPts - a.gapPts);
}
