import { Card } from '@/app/_components/ui/card';
import { cn } from '@/app/_lib/utils';

/**
 * "How your agent works" — the five-step pipeline every action goes through.
 *
 * Static explainer chrome, not per-user data: there is no backend record of
 * "step 4 of 5" for a given action, so it stays hardcoded. It used to sit in
 * the middle of the home dashboard, where after the first visit it was
 * furniture between a person and their money. It lives on the Agent screen
 * now — the one place someone goes to understand or adjust the agent.
 */
const PIPE = [
  { n: '1', t: 'Research', b: 'Scans the network for instruments that fit', flag: false },
  { n: '2', t: 'Suitability', b: 'Checks it against your own risk band', flag: false },
  { n: '3', t: 'Compliance', b: 'KYC, suitability and source-of-funds checks', flag: false },
  { n: '4', t: 'Your confirmation', b: 'You confirm every move before routing', flag: true },
  { n: '5', t: 'Execute', b: 'Routed to the licensed partner, then monitored', flag: false },
];

export function AgentPipeline() {
  return (
    <Card className="p-0">
      {/* Collapsed by default: one quiet line, not another block of cards on a
          screen that already has plenty. The five steps open on demand. */}
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-3 p-[18px] [&::-webkit-details-marker]:hidden">
          <span className="text-xs font-bold uppercase tracking-[1px] text-foreground">
            How your agent works
          </span>
          <span className="text-sm text-dim">
            Every action is researched, screened and checked, then brought to you —{' '}
            <span className="font-semibold text-teal2 group-open:hidden">see the five steps</span>
            <span className="hidden font-semibold text-teal2 group-open:inline">
              hide the steps
            </span>
          </span>
        </summary>
        <div className="g5 px-[18px] pb-[18px]">
          {PIPE.map((s) => (
            <div
              key={s.n}
              className={cn(
                'rounded-xl border p-4',
                s.flag
                  ? 'border-[#e7c3ab] bg-[#f9ede2] dark:border-[#5a3f2a] dark:bg-[#2e2118]'
                  : 'border-border bg-[#fbfaf6] dark:bg-white/[0.02]',
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={cn(
                    'grid h-6 w-6 place-items-center rounded-[7px] font-mono text-[13px] font-bold',
                    s.flag ? 'bg-[#f0d3bd] text-terra-ink dark:bg-[#4a3320]' : 'bg-mint text-teal2',
                  )}
                >
                  {s.n}
                </span>
                <b className="text-[14.5px]">{s.t}</b>
              </div>
              <div
                className={cn(
                  'text-[13px] leading-snug',
                  s.flag ? 'text-[#8a5a3e] dark:text-[#c99a76]' : 'text-dim',
                )}
              >
                {s.b}
              </div>
            </div>
          ))}
        </div>
      </details>
    </Card>
  );
}
