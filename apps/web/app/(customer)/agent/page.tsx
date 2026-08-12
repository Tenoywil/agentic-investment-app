'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Switch } from '@/app/_components/ui/switch';
import { cn } from '@/app/_lib/utils';
import {
  AgentApiError,
  type AgentMessage,
  type Approval,
  type ApprovalType,
  approveApproval,
  getAgentHistory,
  getApprovals,
  rejectApproval,
  streamAgentMessage,
} from '@/lib/agent-api';
import {
  type Limits,
  LimitsApiError,
  type LimitsFlag,
  type LimitsResponse,
  formatBps,
  formatLimitMinor,
  getLimits,
  updateLimits,
} from '@/lib/limits-api';
import { getOpportunities } from '@/lib/opportunities-api';
import { getPortfolio } from '@/lib/portfolio-api';
import { ArrowRight, CheckCheck, CircleAlert, Sparkles } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

type ChatEntry = { role: 'agent' | 'user'; text: string };

const SUGGESTIONS: { label: string }[] = [
  { label: 'Summarize my week' },
  { label: 'Rebalance ideas' },
  { label: 'Best income deal?' },
];

/** Render agent replies' <b>…</b> emphasis (if any) without dangerouslySetInnerHTML. */
function renderRich(text: string): ReactNode {
  return text.split(/(<b>.*?<\/b>)/g).map((part, i) => {
    if (part.startsWith('<b>')) {
      // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable segments
      return <strong key={i}>{part.slice(3, -4)}</strong>;
    }
    return part;
  });
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 rounded-[4px_14px_14px_14px] bg-[#f4f0e7] px-[15px] py-3.5 dark:bg-white/[0.05]">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-faint" />
    </div>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-[#a44e20] dark:text-terra">
      <CircleAlert className="h-4 w-4 flex-none" aria-hidden />
      {children}
    </p>
  );
}

function formatMoney(minor: string, currency: string): string {
  const n = Number(minor) / 100;
  const prefix = currency === 'USD' ? 'US$' : `${currency} `;
  return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatWhen(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

const APPROVAL_META: Record<
  ApprovalType,
  { label: string; variant: BadgeProps['variant']; accent: string }
> = {
  investment_rec: { label: 'Recommendation', variant: 'secondary', accent: '#0e5952' },
  fund_transfer: { label: 'Fund transfer', variant: 'terra', accent: '#c56a3e' },
  plan_enrollment: { label: 'Plan enrollment', variant: 'outline', accent: '#124e48' },
};

/**
 * The guardrail rules, in the order the Limits Engine applies them. Labels and
 * explanations are static chrome; every value and every switch position comes
 * from GET /api/limits, because this table is the literal input the engine
 * evaluates before any money moves. It used to be a constant, with the switches
 * flipping React state — a user could turn "require approval" off on screen
 * while the server went on requiring it, and nothing anywhere would disagree
 * out loud.
 */
const RULES: {
  flag: LimitsFlag;
  label: string;
  note: string;
  /** Null means the rule has no amount set yet, so its row is not rendered. */
  value: (limits: Limits) => string | null;
}[] = [
  {
    flag: 'autoInvestEnabled',
    label: 'Auto-invest idle cash',
    note: 'The most it may commit without asking',
    value: (l) => `≤ ${formatLimitMinor(l.autoInvestCapMinor)}`,
  },
  {
    flag: 'cashFloorEnabled',
    label: 'Keep a cash floor',
    note: 'Never swept below this',
    value: (l) => formatLimitMinor(l.cashFloorMinor),
  },
  {
    flag: 'fxSpreadEnabled',
    label: 'FX spread guardrail',
    note: 'Holds transfers above this spread for review',
    value: (l) => `≤ ${formatBps(l.fxSpreadMaxBps)}`,
  },
  {
    flag: 'requireApprovalEnabled',
    label: 'Require approval above',
    note: 'Bigger moves always ask you',
    value: (l) => formatLimitMinor(l.requireApprovalAboveMinor),
  },
  {
    flag: 'singlePositionEnabled',
    label: 'Single-position cap',
    note: 'Share of your portfolio in any one holding',
    value: (l) => `≤ ${l.singlePositionMaxPct}%`,
  },
  {
    flag: 'dailyCapEnabled',
    label: 'Daily cap',
    note: 'Total it may commit in a single day',
    value: (l) => (l.dailyCapMinor === null ? null : formatLimitMinor(l.dailyCapMinor)),
  },
];

const UPPR = 'text-xs font-bold uppercase tracking-[1px]';

type HistoryState = 'loading' | 'ready' | 'error';
type ApprovalsState = 'loading' | 'ready' | 'error';

function fromHistory(messages: AgentMessage[]): ChatEntry[] {
  return messages.map((m) => ({ role: m.role, text: m.content }));
}

/**
 * What the agent is actually watching. Two counts, both real: instruments in
 * the live catalogue (GET /api/opportunities) and the institutions this user
 * holds with (GET /api/portfolio). The row previously read "47 instruments
 * monitored · 8 licensed partners · 6 matched to goals · 11 actions this
 * month"; none of the four came from anywhere. A count that hasn't loaded is
 * left out rather than shown as a zero.
 */
function AgentStats() {
  const [instruments, setInstruments] = useState<number | null>(null);
  const [partners, setPartners] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOpportunities()
      .then(({ opportunities }) => {
        if (!cancelled) setInstruments(opportunities.length);
      })
      .catch(() => {
        // A missing count is simply not shown — never a zero standing in for
        // "we could not ask".
      });
    getPortfolio()
      .then((p) => {
        if (!cancelled) setPartners(p.partners.length);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const stats: { n: number; cls: string; t: string }[] = [];
  if (instruments !== null) {
    stats.push({
      n: instruments,
      cls: 'text-foreground',
      t: instruments === 1 ? 'instrument monitored' : 'instruments monitored',
    });
  }
  if (partners !== null) {
    stats.push({
      n: partners,
      cls: 'text-teal2',
      t: partners === 1 ? 'institution you hold with' : 'institutions you hold with',
    });
  }
  if (stats.length === 0) return null;

  return (
    <div className="-mt-2.5 mb-2 flex flex-wrap items-center gap-4 text-sm text-dim">
      {stats.map((s) => (
        <span key={s.t}>
          <b className={cn('font-mono', s.cls)}>{s.n}</b> {s.t}
        </span>
      ))}
    </div>
  );
}

/**
 * The limits card. Toggling a switch writes to PUT /api/limits immediately and
 * optimistically; the server's response replaces local state on success, and a
 * failure rolls the switch back and says why, rather than leaving the screen
 * claiming a rule the engine isn't applying.
 */
function LimitsCard() {
  const [data, setData] = useState<LimitsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingFlag, setSavingFlag] = useState<LimitsFlag | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getLimits()
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(
          err instanceof LimitsApiError ? err.message : 'Could not load your limits and rules.',
        );
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(flag: LimitsFlag) {
    if (!data || savingFlag) return;
    const previous = data;
    const next = !data.limits[flag];
    setData({ ...data, limits: { ...data.limits, [flag]: next } });
    setSavingFlag(flag);
    setSaveError(null);
    try {
      // The server is authoritative: its answer replaces the optimistic guess.
      setData(await updateLimits({ [flag]: next }));
    } catch (err) {
      setData(previous);
      setSaveError(
        err instanceof LimitsApiError ? err.message : 'Could not save that change. Try again.',
      );
    } finally {
      setSavingFlag(null);
    }
  }

  return (
    <Card className="p-5" data-tour="customer-limits">
      <div className="mb-1 flex items-baseline justify-between gap-2.5">
        <span className={cn(UPPR, 'text-foreground')}>Your limits &amp; rules</span>
        <span className="text-[12.5px] text-faint">what it may do alone</span>
      </div>

      {state === 'ready' && data && (
        <p className="mb-2.5 text-[12.5px] text-faint">
          {data.source === 'defaults' || !data.updatedAt
            ? "CCN's starting limits — you haven't changed anything yet"
            : `You last changed these ${formatWhen(data.updatedAt)}`}
        </p>
      )}

      {state === 'loading' && <p className="text-sm text-dim">Loading your limits…</p>}

      {state === 'error' && <InlineError>{loadError}</InlineError>}

      {saveError && (
        <div className="mb-2.5" aria-live="polite">
          <InlineError>{saveError}</InlineError>
        </div>
      )}

      {state === 'ready' &&
        data &&
        // A rule with no amount set has nothing to enforce, so it isn't shown —
        // a switch the server would refuse is worse than no switch at all.
        RULES.map((rule) => ({ rule, value: rule.value(data.limits) }))
          .filter((r): r is { rule: (typeof RULES)[number]; value: string } => r.value !== null)
          .map(({ rule, value }, i) => {
            const on = data.limits[rule.flag];
            return (
              <div
                key={rule.flag}
                className={cn(
                  'flex items-center gap-3 py-3',
                  i === 0 ? '' : 'border-t border-border',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-bold">{rule.label}</div>
                  <div className="text-[12.5px] text-faint">{rule.note}</div>
                </div>
                <span
                  className={cn(
                    'font-mono text-[13.5px] font-bold',
                    on ? 'text-teal2' : 'text-faint line-through',
                  )}
                >
                  {value}
                </span>
                <Switch
                  checked={on}
                  disabled={savingFlag !== null}
                  onCheckedChange={() => toggle(rule.flag)}
                  aria-label={`${rule.label} — ${value}`}
                  className="flex-none"
                />
              </div>
            );
          })}
    </Card>
  );
}

export default function AgentPage() {
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [historyState, setHistoryState] = useState<HistoryState>('loading');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [approvalsState, setApprovalsState] = useState<ApprovalsState>('loading');
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [blockedById, setBlockedById] = useState<
    Record<string, { code: string; reasons: string[] }>
  >({});
  const [actionErrorById, setActionErrorById] = useState<Record<string, string>>({});

  useEffect(() => {
    getAgentHistory()
      .then(({ messages }) => {
        setChat(fromHistory(messages));
        setHistoryState('ready');
        scrollToBottom();
      })
      .catch((err) => {
        setHistoryError(
          err instanceof AgentApiError ? err.message : 'Could not load your conversation.',
        );
        setHistoryState('error');
      });

    getApprovals()
      .then(({ approvals: rows }) => {
        setApprovals(rows.filter((a) => a.status === 'pending'));
        setApprovalsState('ready');
      })
      .catch((err) => {
        setApprovalsError(
          err instanceof AgentApiError ? err.message : 'Could not load your approvals.',
        );
        setApprovalsState('error');
      });
  }, []);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  function send(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    setStreamError(null);
    setDraft('');
    setSending(true);
    setChat((c) => [...c, { role: 'user', text: t }, { role: 'agent', text: '' }]);
    scrollToBottom();

    streamAgentMessage(t, {
      onDelta: (delta) => {
        setChat((c) => {
          const last = c[c.length - 1];
          if (!last || last.role !== 'agent') return c;
          const next = c.slice();
          next[next.length - 1] = { role: 'agent', text: last.text + delta };
          return next;
        });
        scrollToBottom();
      },
      onDone: () => {
        setSending(false);
      },
      onError: (message) => {
        setStreamError(message);
        // Drop the empty placeholder bubble if nothing streamed in before the failure.
        setChat((c) => {
          const last = c[c.length - 1];
          if (last && last.role === 'agent' && last.text === '') return c.slice(0, -1);
          return c;
        });
      },
    });
  }

  async function handleApprove(id: string) {
    setActioningId(id);
    setActionErrorById((e) => ({ ...e, [id]: '' }));
    setBlockedById((b) => {
      if (!(id in b)) return b;
      const next = { ...b };
      delete next[id];
      return next;
    });
    try {
      const result = await approveApproval(id);
      if (result.decision === 'blocked') {
        setBlockedById((b) => ({ ...b, [id]: { code: result.code, reasons: result.reasons } }));
      } else {
        setApprovals((list) => list.filter((a) => a.id !== id));
      }
    } catch (err) {
      setActionErrorById((e) => ({
        ...e,
        [id]: err instanceof AgentApiError ? err.message : 'Could not approve this item.',
      }));
    } finally {
      setActioningId(null);
    }
  }

  async function handleReject(id: string) {
    setActioningId(id);
    setActionErrorById((e) => ({ ...e, [id]: '' }));
    try {
      await rejectApproval(id);
      setApprovals((list) => list.filter((a) => a.id !== id));
    } catch (err) {
      setActionErrorById((e) => ({
        ...e,
        [id]: err instanceof AgentApiError ? err.message : 'Could not dismiss this item.',
      }));
    } finally {
      setActioningId(null);
    }
  }

  return (
    <AppScreen active="agent">
      <PageHead
        eyebrow="Discovers, screens and coordinates execution, always on your approval"
        title="Your Capital Agent"
      />

      <AgentStats />
      <div className="mb-[18px] inline-flex items-center gap-2 rounded-full bg-mint px-3 py-1.5 text-[13.5px] font-bold text-teal2">
        <span className="h-2 w-2 rounded-full bg-success" />
        Live · monitoring the region
      </div>

      <div className="g-agent">
        {/* Chat */}
        <Card className="flex flex-col overflow-hidden" data-tour="customer-agent">
          <div className="flex items-center gap-3 border-b border-border px-5 py-[18px]">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-primary text-[#eafaf5]">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-base font-bold">CCN Capital Agent</div>
              <div className="flex items-center gap-1.5 text-[13px] text-dim">
                <span className="h-[7px] w-[7px] rounded-full bg-success" />
                Suitability-aware · acts on your approval
              </div>
            </div>
          </div>

          <div
            ref={logRef}
            aria-live="polite"
            aria-label="Conversation with your agent"
            className="flex max-h-[440px] min-h-[220px] flex-col gap-3.5 overflow-y-auto px-5 py-[18px]"
          >
            {historyState === 'loading' && (
              <div className="flex flex-1 items-center justify-center py-10 text-sm text-dim">
                Loading your conversation…
              </div>
            )}

            {historyState === 'error' && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
                <InlineError>{historyError}</InlineError>
                <p className="text-[13px] text-dim">
                  You can still start a new conversation below.
                </p>
              </div>
            )}

            {historyState !== 'loading' && chat.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-mint text-teal2">
                  <Sparkles className="h-6 w-6" aria-hidden />
                </span>
                <p className="text-[15px] font-bold">Say hello to your Capital Agent</p>
                <p className="max-w-[320px] text-[13.5px] leading-relaxed text-dim">
                  Ask about income opportunities, rebalancing, idle cash, or how approvals and
                  custody work. It only prepares — you approve every action.
                </p>
              </div>
            )}

            {chat.map((m, i) => {
              const isLast = i === chat.length - 1;
              const isPending = sending && isLast && m.role === 'agent' && m.text === '';
              return m.role === 'agent' ? (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  className="flex max-w-[88%] items-start gap-2.5"
                >
                  <span className="mt-0.5 grid h-[26px] w-[26px] flex-none place-items-center rounded-full bg-mint text-teal2">
                    <Sparkles className="h-[15px] w-[15px]" aria-hidden />
                  </span>
                  {isPending ? (
                    <TypingIndicator />
                  ) : (
                    <div className="rounded-[4px_14px_14px_14px] bg-[#f4f0e7] dark:bg-white/[0.05] px-[15px] py-3 text-[14.5px] leading-relaxed text-[#2c2925] dark:text-foreground">
                      {renderRich(m.text)}
                    </div>
                  )}
                </div>
              ) : (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  className="max-w-[82%] self-end"
                >
                  <div className="rounded-[14px_4px_14px_14px] bg-primary px-[15px] py-3 text-[14.5px] leading-normal text-white">
                    {renderRich(m.text)}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-5 pb-[18px]">
            {streamError && (
              <div className="mb-3">
                <InlineError>{streamError}</InlineError>
              </div>
            )}
            <div className="mb-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s.label}
                  variant="outline"
                  size="sm"
                  disabled={sending}
                  className="rounded-[20px] font-semibold text-teal2"
                  onClick={() => send(s.label)}
                >
                  {s.label}
                </Button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className="flex items-center gap-2 rounded-[14px] border border-border bg-card py-1.5 pl-3.5 pr-1.5"
            >
              <label htmlFor={inputId} className="sr-only">
                Ask your agent
              </label>
              <input
                id={inputId}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={sending}
                placeholder="Ask your agent about income, rebalancing, or a specific deal…"
                className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[15px] text-foreground outline-none placeholder:text-faint disabled:opacity-60"
              />
              <Button
                type="submit"
                size="icon"
                aria-label="Send message"
                disabled={sending || draft.trim().length === 0}
                className="h-[38px] w-[38px] flex-none rounded-[10px]"
              >
                <ArrowRight className="h-[18px] w-[18px]" />
              </Button>
            </form>
          </div>
        </Card>

        {/* Approvals + limits */}
        <div className="flex flex-col gap-[18px]">
          <Card className="p-5" data-tour="customer-approvals">
            <div className="mb-3.5 flex items-center gap-2.5">
              <span className={cn(UPPR, 'text-foreground')}>Needs your approval</span>
              {approvalsState === 'ready' && approvals.length > 0 && (
                <span className="min-w-[22px] rounded-full bg-[#f9ede2] dark:bg-[#2e2118] px-2 py-px text-center text-[12.5px] font-bold text-terra-ink">
                  {approvals.length}
                </span>
              )}
            </div>

            {approvalsState === 'loading' && (
              <p className="text-sm text-dim">Loading your approvals…</p>
            )}

            {approvalsState === 'error' && <InlineError>{approvalsError}</InlineError>}

            {approvalsState === 'ready' && approvals.length === 0 && (
              <EmptyState
                icon={CheckCheck}
                title="Nothing needs your approval"
                body="When your agent prepares a move that sits outside your limits, it waits for you here."
              />
            )}

            {approvalsState === 'ready' &&
              approvals.map((a) => {
                const meta = APPROVAL_META[a.type];
                const blocked = blockedById[a.id];
                const actionError = actionErrorById[a.id];
                const busy = actioningId === a.id;
                return (
                  <div
                    key={a.id}
                    className="mb-3 rounded-xl border border-border p-4"
                    style={{ borderLeft: `3px solid ${meta.accent}` }}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="text-[12.5px] text-faint">{formatWhen(a.createdAt)}</span>
                    </div>
                    <div className="mb-1.5 text-[15px] font-bold">{a.title}</div>
                    {a.body && (
                      <p className="mb-2 text-[13.5px] leading-normal text-dim">{a.body}</p>
                    )}
                    {a.amountMinor !== null && (
                      <p className="mb-3 font-mono text-[13.5px] font-bold text-teal2">
                        {formatMoney(a.amountMinor, a.currency)}
                      </p>
                    )}
                    {actionError && (
                      <div className="mb-3">
                        <InlineError>{actionError}</InlineError>
                      </div>
                    )}
                    {blocked && (
                      <div className="mb-3 rounded-lg border border-[#ecd2c2] bg-[#fbeee7] px-3 py-2.5 text-[13px] leading-snug text-[#5c4636] dark:border-[#5a3f2e] dark:bg-[#2c1f17] dark:text-[#d3b8a4]">
                        <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-[.4px]">
                          <CircleAlert
                            className="h-3.5 w-3.5 text-[#a44e20] dark:text-terra"
                            aria-hidden
                          />
                          Can't approve this right now
                        </div>
                        <ul className="list-disc pl-[18px]">
                          {blocked.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button
                        className="h-10 flex-1"
                        disabled={busy}
                        onClick={() => handleApprove(a.id)}
                      >
                        {busy ? 'Working…' : 'Approve'}
                      </Button>
                      <Button
                        variant="outline"
                        className="h-10 text-dim"
                        disabled={busy}
                        onClick={() => handleReject(a.id)}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
          </Card>

          <LimitsCard />
        </div>
      </div>
    </AppScreen>
  );
}
