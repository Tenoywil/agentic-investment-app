/**
 * Marks a panel whose figures come from a sandbox partner's book.
 *
 * The KPI tiles and the onboarding funnel are computed from this partner's own
 * connections, holdings and orders — real rows, correctly counted. What makes
 * them illustrative is the book they are counted from: a partner whose agreement
 * status is `sandbox` is rehearsing, and its balances come from the sandbox
 * adapter rather than from a settled account at the firm. Saying so is the
 * difference between a demo and a claim.
 */
export function SandboxBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-solid border-border bg-[#f4f0e7] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-dim dark:bg-white/[0.06]">
      Illustrative · sandbox partner
    </span>
  );
}
