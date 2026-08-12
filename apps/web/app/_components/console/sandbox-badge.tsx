/**
 * Marks a panel whose figures come from a sandbox partner's book.
 *
 * The KPI tiles, the onboarding funnel and the per-listing AUM are genuine
 * `partner_kpis` / `kyc_funnel_stages` / `product_listings` rows — but for a
 * partner whose agreement status is `sandbox`, i.e. a rehearsal book rather
 * than a settled one. Saying so is the difference between a demo and a claim.
 * A partner with no rows at all gets an <EmptyState> instead, never this.
 */
export function SandboxBadge({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const skin =
    tone === 'dark'
      ? 'border-white/15 bg-white/10 text-[#eafaf5]/85'
      : 'border-border bg-[#f4f0e7] text-faint dark:bg-white/[0.06]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-solid px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${skin}`}
    >
      Illustrative · sandbox partner
    </span>
  );
}
