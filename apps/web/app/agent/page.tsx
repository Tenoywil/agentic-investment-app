'use client';

import { AppScreen, PageHead } from '@/app/_components/AppScreen';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
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
import { ArrowRight, CircleAlert, Mic, Sparkles, Volume2, VolumeX } from 'lucide-react';
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

const RULES = [
  {
    label: 'Auto-invest idle cash',
    note: 'Into your money-market fund',
    value: '≤ US$500',
    on: true,
  },
  { label: 'Keep a cash floor', note: 'Never swept below this', value: 'US$1,000', on: true },
  { label: 'FX spread guardrail', note: 'Holds transfers for review', value: '≤ 0.3%', on: true },
  {
    label: 'Require approval above',
    note: 'Bigger moves always ask you',
    value: 'US$1,000',
    on: true,
  },
];

const UPPR = 'text-xs font-bold uppercase tracking-[1px]';

const STATS: { n: string; cls: string; t: string }[] = [
  { n: '47', cls: 'text-foreground', t: 'instruments monitored' },
  { n: '8', cls: 'text-teal2', t: 'licensed partners' },
  { n: '6', cls: 'text-terra', t: 'matched to goals' },
  { n: '11', cls: 'text-success', t: 'actions this month' },
];

type HistoryState = 'loading' | 'ready' | 'error';
type ApprovalsState = 'loading' | 'ready' | 'error';

function fromHistory(messages: AgentMessage[]): ChatEntry[] {
  return messages.map((m) => ({ role: m.role, text: m.content }));
}

export default function AgentPage() {
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [historyState, setHistoryState] = useState<HistoryState>('loading');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [voice, setVoice] = useState(false);
  const [rules, setRules] = useState(RULES.map((r) => r.on));
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

      <div className="-mt-2.5 mb-2 flex flex-wrap items-center gap-4 text-sm text-dim">
        {STATS.map((s) => (
          <span key={s.t}>
            <b className={cn('font-mono', s.cls)}>{s.n}</b> {s.t}
          </span>
        ))}
      </div>
      <div className="mb-[18px] inline-flex items-center gap-2 rounded-full bg-mint px-3 py-1.5 text-[13.5px] font-bold text-teal2">
        <span className="h-2 w-2 rounded-full bg-success" />
        Live · monitoring the region
      </div>

      <div className="g-agent">
        {/* Chat */}
        <Card className="flex flex-col overflow-hidden">
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
            <button
              type="button"
              aria-pressed={voice}
              onClick={() => setVoice((v) => !v)}
              className={cn(
                'inline-flex flex-none items-center gap-1.5 rounded-[10px] border border-border px-3 py-2 text-[13.5px] font-bold',
                voice ? 'bg-mint text-teal2' : 'bg-card text-dim',
              )}
            >
              {voice ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              Voice {voice ? 'on' : 'off'}
            </button>
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
                type="button"
                variant="secondary"
                size="icon"
                aria-label="Voice input"
                className="h-[38px] w-[38px] flex-none rounded-[10px]"
              >
                <Mic className="h-[17px] w-[17px]" />
              </Button>
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
          <Card className="p-5">
            <div className="mb-3.5 flex items-center gap-2.5">
              <span className={cn(UPPR, 'text-foreground')}>Needs your approval</span>
              {approvalsState === 'ready' && approvals.length > 0 && (
                <span className="min-w-[22px] rounded-full bg-[#f9ede2] dark:bg-[#2e2118] px-2 py-px text-center text-[12.5px] font-bold text-terra">
                  {approvals.length}
                </span>
              )}
            </div>

            {approvalsState === 'loading' && (
              <p className="text-sm text-dim">Loading your approvals…</p>
            )}

            {approvalsState === 'error' && <InlineError>{approvalsError}</InlineError>}

            {approvalsState === 'ready' && approvals.length === 0 && (
              <p className="text-[13.5px] text-dim">Nothing needs your approval right now.</p>
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

          <Card className="p-5">
            <div className="mb-3.5 flex items-baseline justify-between gap-2.5">
              <span className={cn(UPPR, 'text-foreground')}>Your limits &amp; rules</span>
              <span className="text-[12.5px] text-faint">what it may do alone</span>
            </div>
            {RULES.map((r, i) => (
              <div
                key={r.label}
                className={cn(
                  'flex items-center gap-3 py-3',
                  i === 0 ? '' : 'border-t border-border',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-bold">{r.label}</div>
                  <div className="text-[12.5px] text-faint">{r.note}</div>
                </div>
                <span className="font-mono text-[13.5px] font-bold text-teal2">{r.value}</span>
                <Switch
                  checked={rules[i]}
                  onCheckedChange={() => setRules((rs) => rs.map((v, j) => (j === i ? !v : v)))}
                  aria-label={`${r.label} — ${rules[i] ? 'on' : 'off'}`}
                  className="flex-none"
                />
              </div>
            ))}
          </Card>
        </div>
      </div>
    </AppScreen>
  );
}
