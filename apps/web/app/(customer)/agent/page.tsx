'use client';

import { AppScreen } from '@/app/_components/AppScreen';
import { ChatMarkdown } from '@/app/_components/ChatMarkdown';
import { PartnerMark, markFor, usePartnerMarks } from '@/app/_components/PartnerMark';
import { PENDING_QUESTION_KEY } from '@/app/_components/VoiceAsk';
import {
  AgentDisplayCard,
  RiskBadge,
  TraceDisplay,
  type TraceScore,
  extractTraceScores,
} from '@/app/_components/agent-displays';
import { Badge, type BadgeProps } from '@/app/_components/ui/badge';
import { Button } from '@/app/_components/ui/button';
import { Card } from '@/app/_components/ui/card';
import { EmptyState } from '@/app/_components/ui/empty';
import { Skeleton, SkeletonCard, SkeletonRegion } from '@/app/_components/ui/skeleton';
import { Switch } from '@/app/_components/ui/switch';
import { useSheetDismiss } from '@/app/_lib/sheet';
import { useDictation, useNarration } from '@/app/_lib/speech';
import { useRealtime } from '@/app/_lib/use-realtime';
import { cn, splitApprovalTitle } from '@/app/_lib/utils';
import {
  AgentApiError,
  type AgentDisplayData,
  type AgentMessage,
  type AgentProposal,
  AlreadyPendingError,
  type Approval,
  type ApprovalType,
  approveApproval,
  createApproval,
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
import {
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  CircleAlert,
  Info,
  Mic,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * One row of the conversation log: a spoken turn, or a visual card the agent's
 * tools produced (allocation chart, goal bars, a comparison, a fit score, the
 * pipeline trace). Cards are their own entries rather than markup inside a
 * bubble so the log stays append-only and each card keeps a stable position.
 */
type ChatEntry =
  | { role: 'agent' | 'user'; text: string }
  | { role: 'agent'; display: AgentDisplayData };

/**
 * What a voice user hears about the cards, which are otherwise silent. Kinds
 * only — never figures, which the narration would otherwise have to re-read
 * off a chart that is already on screen.
 */
const DISPLAY_NARRATION: Record<AgentDisplayData['kind'], string> = {
  allocation: 'your allocation breakdown',
  goals: 'your goal progress',
  comparison: 'a side-by-side comparison',
  fit: 'a fit score card',
  pipeline: 'the step-by-step decision trail',
};

function narratedDisplays(kinds: AgentDisplayData['kind'][]): string {
  const nouns = [...new Set(kinds)].map((k) => DISPLAY_NARRATION[k]);
  if (nouns.length === 0) return '';
  const list =
    nouns.length === 1
      ? nouns[0]
      : `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}`;
  return ` I've also put ${list} on screen for you.`;
}

/**
 * Plain questions, not analyst shorthand. "Rebalance ideas" assumes the reader
 * knows what rebalancing is; the person this product serves may be meeting
 * these words for the first time, and a chip they don't understand is a
 * feature they never use.
 */
const SUGGESTIONS: { label: string }[] = [
  { label: 'What am I invested in?' },
  { label: 'What should I look at next?' },
  { label: 'Find me an income deal' },
  { label: 'Summarize my week' },
];

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

const CURRENCY_PREFIX: Record<string, string> = {
  USD: 'US$',
  JMD: 'J$',
  TTD: 'TT$',
  GYD: 'G$',
  BBD: 'Bds$',
  XCD: 'EC$',
  BSD: 'B$',
};

function formatMoney(minor: string, currency: string): string {
  const n = Number(minor) / 100;
  const prefix = CURRENCY_PREFIX[currency] ?? `${currency} `;
  return `${prefix}${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

/**
 * The pipeline trace off an approval's snapshot, read defensively: `snapshot`
 * is untyped JSONB, and cards raised before the pipeline existed carry none.
 * A malformed entry drops rather than rendering a half-claim about how a
 * recommendation about someone's money was made.
 */
function decisionTrace(
  snapshot: unknown,
): { stage: string; agent: string; summary: string; detail: string[] }[] | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const t = (snapshot as Record<string, unknown>).trace;
  if (!Array.isArray(t)) return null;
  const rows = t
    .filter(
      (r): r is Record<string, unknown> =>
        !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).summary === 'string',
    )
    .map((r) => ({
      stage: typeof r.stage === 'string' ? r.stage : '',
      agent: typeof r.agent === 'string' ? r.agent : 'Agent',
      summary: r.summary as string,
      detail: Array.isArray(r.detail)
        ? r.detail.filter((d): d is string => typeof d === 'string')
        : [],
    }));
  return rows.length > 0 ? rows : null;
}

/**
 * The executing firm and its regulator off an approval's snapshot, read
 * defensively like the trace: untyped JSONB, and most cards carry neither.
 * Nothing is rendered for a missing value — a trust disclosure that invents
 * its facts would be the opposite of one.
 */
function snapshotFirm(snapshot: unknown): { firm: string | null; regulator: string | null } {
  if (!snapshot || typeof snapshot !== 'object') return { firm: null, regulator: null };
  const s = snapshot as Record<string, unknown>;
  const firm =
    typeof s.partner === 'string'
      ? s.partner
      : typeof s.partnerName === 'string'
        ? s.partnerName
        : null;
  return { firm, regulator: typeof s.regulator === 'string' ? s.regulator : null };
}

/**
 * The risk word the recommendation's own case states ("medium risk"), for a
 * chip. Read from the body, never asserted: a card whose case names no risk
 * band gets no risk chip.
 */
const RISK_IN_BODY = /\b(low|medium|high) risk\b/i;

/**
 * The executing firm off the trace's coordination detail line
 * ("Executing firm: X"), written by the pipeline when it chose one. The
 * pipeline's own placeholder for an unnamed firm is not a firm and yields no
 * chip.
 */
function traceFirm(trace: { detail: string[] }[] | null): string | null {
  if (!trace) return null;
  for (const stage of trace) {
    for (const line of stage.detail) {
      const match = /^Executing firm: (.+)$/.exec(line);
      if (match?.[1] && match[1] !== 'your connected firm') return match[1];
    }
  }
  return null;
}

/** Trace score labels, shortened for the fact-chip row. */
const SCORE_CHIP_LABEL: Record<string, string> = {
  Fit: 'fit',
  'Research confidence': 'research',
};

/**
 * The case, condensed: the first sentence or two (~180 chars) reads on the
 * card; the remainder folds into the disclosure details. Splits only on
 * ". " boundaries so amounts like "US$2,010.50" never get cut mid-figure.
 */
function condenseBody(body: string): { lead: string; rest: string | null } {
  const sentences = body.split('. ');
  let lead = sentences[0] ?? body;
  let taken = 1;
  while (taken < sentences.length && `${lead}. ${sentences[taken]}`.length <= 180) {
    lead = `${lead}. ${sentences[taken]}`;
    taken += 1;
  }
  if (taken >= sentences.length) return { lead: body, rest: null };
  // The split ate the lead's closing period; put it back.
  return { lead: `${lead}.`, rest: sentences.slice(taken).join('. ') };
}

/**
 * "Why trust this?" — the same three facts on every proposal and approval
 * card: who would execute (when the data names them), what the screening was,
 * and how CCN is paid. The firm line renders only from real card data, and the
 * score chips only when the decision trace actually recorded scores.
 */
function TrustNote({
  firm,
  regulator,
  scores,
  className,
}: {
  firm?: string | null;
  regulator?: string | null;
  scores?: TraceScore[];
  className?: string;
}) {
  return (
    <details className={cn('rounded-lg bg-muted/60 px-3 py-2', className)}>
      <summary className="cursor-pointer text-[12.5px] font-bold text-dim">Why trust this?</summary>
      <div className="mt-1.5 flex flex-col gap-1 text-[12.5px] leading-snug text-dim">
        {firm && (
          <p className="m-0">
            Executed by the licensed firm <b className="text-foreground">{firm}</b>
            {regulator && <>, regulated by {regulator},</>} never by CCN.
          </p>
        )}
        <p className="m-0">
          Screened against your own risk band and limits, not a sales list. Firms don't pay for
          placement; CCN charges one flat platform fee.
        </p>
        {scores && scores.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1.5">
            {scores.map((s) => (
              <Badge key={s.label} variant="secondary" className="font-mono">
                {s.label} {s.score}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </details>
  );
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
  /*
    The FX spread guardrail is not here, and should not be until it does
    something. `GateInput.isFxTransfer` and `fxSpreadBps` are optional and no
    caller sets them: services/gate.ts defaults them to `false` and `0`, and the
    agent hardcodes the same, so the branch in limits-engine that compares them
    is unreachable in production. The row rendered a switch an investor could
    turn on, a threshold they could edit, and a promise — "holds transfers above
    this spread for review" — that nothing in the system could keep.

    A guardrail that cannot fire is worse than an absent one: it is the control
    someone believes is protecting them. It comes back when a transfer path
    exists to measure a spread on, which is also when CCN would have a spread to
    know about — it routes orders and moves no money today. The column, the
    engine branch and the PUT /api/limits handling all stay, so restoring this is
    one entry in this list.
  */
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

  // Inline chips, not a row of their own: the preamble is one line on a
  // desktop, and every line it grows is a line taken from the conversation.
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] text-dim">
      <span className="flex items-center gap-1.5 font-bold text-teal2">
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
        Live
      </span>
      {instruments !== null && (
        <span>
          · watching <b className="font-mono text-foreground">{instruments}</b>{' '}
          {instruments === 1 ? 'product' : 'products'} on the marketplace
        </span>
      )}
      {partners !== null && partners > 0 && (
        <span>
          · <b className="font-mono text-teal2">{partners}</b>{' '}
          {partners === 1 ? 'institution' : 'institutions'} you hold with
        </span>
      )}
    </span>
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
            ? "CCN's starting limits. You haven't changed anything yet"
            : `You last changed these ${formatWhen(data.updatedAt)}`}
        </p>
      )}

      {state === 'loading' && (
        // Five rows, because five rules land here. The single line this replaced
        // was the largest single contributor to this screen's 0.38 layout shift.
        <SkeletonRegion label="Loading your limits" className="flex flex-col gap-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="mb-1.5 h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-6 w-16 flex-none" />
              <Skeleton className="h-6 w-10 flex-none rounded-full" />
            </div>
          ))}
        </SkeletonRegion>
      )}

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
                  i === 0 ? '' : 'border-t border-solid border-x-0 border-b-0 border-border',
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
                  aria-label={`${rule.label}: ${value}`}
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
  /**
   * Moves the agent prepared this session.
   *
   * The approvals panel below has always been able to show and decide approval
   * cards, and nothing in the product could create one — POST /api/approvals had
   * no caller, and the only writer of an approval row was the demo seed. So the
   * loop the product is built around was reachable only by an email allowlist.
   * These are the missing half: a proposal, and a button that raises it.
   */
  const [proposals, setProposals] = useState<AgentProposal[]>([]);
  const [raisingId, setRaisingId] = useState<string | null>(null);
  const [raiseError, setRaiseError] = useState<string | null>(null);
  /** Informational, not an error: e.g. "this card already exists". */
  const [raiseNote, setRaiseNote] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState<HistoryState>('loading');
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const narration = useNarration();
  // Dictation fills the composer rather than sending: a portfolio instruction
  // read back wrong should be correctable before it goes anywhere.
  const dictation = useDictation((text) =>
    setDraft((d) => (d.trim() ? `${d.trim()} ${text}` : text)),
  );
  const [sending, setSending] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  /**
   * Approvals and limits, as a sheet on a phone.
   *
   * They are a second column on a desktop and were stacked under the
   * conversation on a phone, which is what made the screen scroll on past the
   * chat: the composer went off the bottom the moment you moved, and coming
   * back meant scrolling up through the whole log. As a sheet the chat keeps
   * the screen and these stay one tap away.
   *
   * A <dialog>, so the browser supplies the top layer, the backdrop, Escape and
   * focus containment. On a desktop CSS puts the display back and it renders in
   * the flow as the column it always was — the same trick the phone nav drawer
   * uses, and the reason the cards exist in exactly one place in the DOM rather
   * than being rendered twice and drifting.
   */
  const panelsRef = useRef<HTMLDialogElement>(null);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const openPanels = () => {
    if (!panelsRef.current?.open) panelsRef.current?.showModal();
    setPanelsOpen(true);
  };
  const closePanels = useCallback(() => panelsRef.current?.close(), []);
  // Same swipe-down the navigation sheet takes, so the two behave alike.
  useSheetDismiss(panelsRef, closePanels);
  const logRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const [approvals, setApprovals] = useState<Approval[]>([]);
  /** Brand marks for the executing-firm chip on approval cards — one cached
   *  read, decorative only; a missing list just means monogram tiles. */
  const marks = usePartnerMarks();
  const [approvalsState, setApprovalsState] = useState<ApprovalsState>('loading');
  const [approvalsError, setApprovalsError] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [blockedById, setBlockedById] = useState<
    Record<string, { code: string; reasons: string[] }>
  >({});
  const [actionErrorById, setActionErrorById] = useState<Record<string, string>>({});

  /**
   * A question asked by voice from another screen, handed over in
   * sessionStorage by the corner control (VoiceAsk).
   *
   * It is read once and cleared immediately, so a refresh does not re-ask it
   * and a later visit does not replay it. It waits for the history to load
   * rather than firing on mount: sending into an empty chat that is about to be
   * replaced would drop the new turn when the fetch lands.
   */
  const askedRef = useRef(false);
  useEffect(() => {
    if (historyState !== 'ready' || askedRef.current) return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(PENDING_QUESTION_KEY);
      if (pending) sessionStorage.removeItem(PENDING_QUESTION_KEY);
    } catch {
      // Storage blocked; nothing was handed over.
    }
    if (!pending) return;
    askedRef.current = true;
    send(pending);
  }, [historyState]);

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

  /**
   * The approvals panel is the human-in-the-loop half of the product, and it was
   * a snapshot taken when the screen mounted. A card raised while somebody sat
   * on this page — the exact situation the panel exists for — did not appear
   * until they navigated away and came back.
   *
   * Only the approvals reload. The conversation above them is appended to by the
   * stream of the turn being typed, and refetching history mid-answer would
   * replace a partly streamed reply with the shorter version stored so far.
   */
  useRealtime(['approval'], () => {
    void getApprovals()
      .then(({ approvals: rows }) => setApprovals(rows.filter((a) => a.status === 'pending')))
      .catch(() => {});
  });

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

    // The reply accumulated locally as well as in state: narration needs the
    // finished text, and by onDone the log's last entry may be a display card
    // rather than the bubble that streamed it.
    let streamed = '';
    const displayKinds: AgentDisplayData['kind'][] = [];

    streamAgentMessage(t, {
      /**
       * A move the agent prepared. It is offered, not taken: raising the
       * approval card is a tap the reader makes, and approving it is a second
       * one. Blocked verdicts are still shown — the guardrail refusing
       * something, with its reasons, is the product working.
       *
       * Deduped by instrument: asking twice about the same deal updates the
       * card the panel already shows instead of stacking a twin under it.
       */
      onProposal: (proposal) =>
        setProposals((p) => {
          const at = p.findIndex((x) => x.instrumentId === proposal.instrumentId);
          if (at === -1) return [...p, proposal];
          const next = p.slice();
          next[at] = proposal;
          return next;
        }),
      /**
       * A visual card, appended after the text that narrates it (the server
       * flushes displays post-text). If the placeholder bubble is still empty
       * — a card-only turn — the card replaces it rather than trailing an
       * empty speech bubble.
       */
      onDisplay: (display) => {
        displayKinds.push(display.kind);
        setChat((c) => {
          const last = c[c.length - 1];
          const base =
            last && last.role === 'agent' && 'text' in last && last.text === ''
              ? c.slice(0, -1)
              : c;
          return [...base, { role: 'agent', display }];
        });
        scrollToBottom();
      },
      onDelta: (delta) => {
        streamed += delta;
        setChat((c) => {
          const last = c[c.length - 1];
          if (!last || last.role !== 'agent' || !('text' in last)) return c;
          const next = c.slice();
          next[next.length - 1] = { role: 'agent', text: last.text + delta };
          return next;
        });
        scrollToBottom();
      },
      onDone: () => {
        setSending(false);
        // Read the finished reply, not each delta: speaking a token stream
        // produces stuttering half-words. Cards are silent visuals, so a voice
        // user hears that they exist — kinds only, never figures. Narration is
        // a no-op unless the user switched it on, so nothing speaks unasked.
        if (streamed) narration.speak(streamed + narratedDisplays(displayKinds));
      },
      onError: (message) => {
        setStreamError(message);
        // Drop the empty placeholder bubble if nothing streamed in before the failure.
        setChat((c) => {
          const last = c[c.length - 1];
          if (last && last.role === 'agent' && 'text' in last && last.text === '') {
            return c.slice(0, -1);
          }
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
      {/* The preamble is ONE compact line: name, then the status chips. This
          screen is a chat experience on every size — a display-size heading,
          a strapline and a stats row were three rows of chrome between the
          person and the conversation, and the rows were what made the page
          taller than the screen. On a phone the whole line folds away
          (globals.css, .agent-preamble) and the chat owns the viewport; the
          h1 stays in the accessible tree either way. */}
      <div className="agent-preamble mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="m-0 font-display text-[22px] font-bold tracking-tight">
          Your Capital Agent
        </h1>
        <AgentStats />
      </div>

      <div className="g-agent">
        {/* Chat */}
        <Card className="agent-chat flex flex-col overflow-hidden" data-tour="customer-agent">
          <div className="agent-chat__head flex items-center gap-3 border-b border-solid border-x-0 border-t-0 border-border px-5 py-[18px]">
            {/* Phone only (CSS): the chat owns the whole screen there, so this
                is the one way back to the rest of the app. */}
            <Link
              href="/home"
              aria-label="Back to dashboard"
              className="agent-chat__back h-10 w-10 flex-none place-items-center rounded-[12px] text-foreground hover:bg-muted"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden />
            </Link>
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-primary text-[#eafaf5]">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-display text-base font-bold">CCN Capital Agent</div>
              {/* Reassurance, and it wraps to three lines beside the two
                  controls on a 390px header. The claim it makes is enforced by
                  the Limits Engine and stated on the limits card, so a phone
                  spends the space on conversation instead. */}
              <div className="flex items-center gap-1.5 text-[13px] text-dim max-[900px]:hidden">
                <span className="h-[7px] w-[7px] rounded-full bg-success" />
                Suitability-aware · acts on your approval
              </div>
            </div>
            {/* Phone only: the way back to approvals and limits, which are a
                column on a desktop. The count is on the button because the
                thing people come here to do is act on a waiting approval, and
                a sheet you have to open to discover it is empty is a worse
                trade than a number in the header. */}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="agent-panels__open h-9 flex-none gap-1.5 px-2.5 font-semibold text-teal2"
              aria-haspopup="dialog"
              aria-expanded={panelsOpen}
              onClick={openPanels}
            >
              <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />
              <span className="sr-only">Approvals and limits</span>
              {approvalsState === 'ready' && approvals.length > 0 ? (
                <span
                  className="min-w-[20px] rounded-full bg-[#f9ede2] px-1.5 text-center text-[12px] font-bold text-terra-ink dark:bg-[#2e2118]"
                  aria-hidden
                >
                  {approvals.length}
                </span>
              ) : null}
            </Button>
            {/* Only where the browser can actually speak. The toggle doubles as
                the stop control while it is talking, so audio is never running
                without something on screen to end it. */}
            {narration.supported && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-pressed={narration.enabled}
                aria-label={narration.enabled ? 'Turn off spoken replies' : 'Read replies aloud'}
                onClick={() => narration.setEnabled(!narration.enabled)}
                className="h-9 w-9 flex-none"
              >
                {narration.enabled ? (
                  <Volume2
                    className={cn('h-[18px] w-[18px]', narration.speaking && 'animate-pulse')}
                    aria-hidden
                  />
                ) : (
                  <VolumeX className="h-[18px] w-[18px] text-dim" aria-hidden />
                )}
              </Button>
            )}
          </div>

          <div
            ref={logRef}
            aria-live="polite"
            aria-label="Conversation with your agent"
            // A fixed height, not a range. Between min-h and max-h the log grew with
            // every message: the card got taller as the agent streamed, pushing the
            // composer down under the cursor and resizing the whole two-column row
            // around it. The conversation scrolls inside a box that does not move.
            // The height is the viewport minus the screen's own chrome (header,
            // status line, chat head, composer, page padding), so on a desktop the
            // whole screen fits without the page scrolling the chat out of view —
            // the panels column handles its own overflow (globals.css).
            className="agent-chat__log flex h-[clamp(420px,calc(100dvh-420px),800px)] flex-col gap-3.5 overflow-y-auto px-5 py-[18px]"
          >
            {historyState === 'loading' && (
              <SkeletonRegion label="Loading your conversation" className="flex flex-col gap-3.5">
                <Skeleton className="h-14 w-4/5 rounded-2xl" />
                <Skeleton className="h-10 w-3/5 self-end rounded-2xl" />
                <Skeleton className="h-16 w-4/5 rounded-2xl" />
              </SkeletonRegion>
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
                  Ask what you're invested in, what's worth a look, or how anything here works. It
                  prepares the move. You say yes or no, every time.
                </p>
              </div>
            )}

            {chat.map((m, i) => {
              if ('display' in m) {
                return (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                    key={i}
                    // Aligned with the agent bubbles (avatar width + gap), and
                    // allowed to run wider than prose: charts earn the room.
                    className="ml-9 min-w-0 max-w-[95%]"
                  >
                    <AgentDisplayCard display={m.display} />
                  </div>
                );
              }
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
                    <div className="min-w-0 rounded-[4px_14px_14px_14px] bg-[#f4f0e7] dark:bg-white/[0.05] px-[15px] py-3 text-[14.5px] leading-relaxed text-[#2c2925] dark:text-foreground">
                      <ChatMarkdown text={m.text} />
                    </div>
                  )}
                </div>
              ) : (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
                  key={i}
                  className="max-w-[82%] self-end"
                >
                  {/* The user's words, verbatim — what a person typed is not
                      markdown, and rendering it as such would reformat them. */}
                  <div className="rounded-[14px_4px_14px_14px] bg-primary px-[15px] py-3 text-[14.5px] leading-normal text-white">
                    {m.text}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="agent-chat__composer px-5 pb-[18px]">
            {streamError && (
              <div className="mb-3">
                <InlineError>{streamError}</InlineError>
              </div>
            )}
            {dictation.error && (
              <div className="mb-3">
                <InlineError>{dictation.error}</InlineError>
              </div>
            )}
            {/* The words as they are heard, live. Dictating into a silent
                input was indistinguishable from a dead microphone; here the
                transcript builds in front of the speaker, and lands in the
                input for correction when they stop. */}
            {dictation.listening && (
              <output
                aria-live="polite"
                className="mb-2.5 flex items-start gap-2 rounded-xl bg-mint/70 px-3.5 py-2.5 text-[13.5px] leading-snug text-foreground dark:bg-white/[0.06]"
              >
                <Mic className="mt-0.5 h-4 w-4 flex-none animate-pulse text-teal2" aria-hidden />
                <span className="min-w-0">
                  {dictation.preview || 'Listening. Your words appear here as you speak.'}
                </span>
              </output>
            )}
            {/* On a phone these wrap to one per line and cost three rows above
                the composer. A single strip that scrolls sideways keeps them
                reachable without pushing the input down the screen. */}
            <div className="mb-3 flex flex-wrap gap-2 max-[900px]:flex-nowrap max-[900px]:overflow-x-auto max-[900px]:pb-1">
              {SUGGESTIONS.map((s) => (
                <Button
                  key={s.label}
                  variant="outline"
                  size="sm"
                  disabled={sending}
                  className="rounded-[20px] font-semibold text-teal2 max-[900px]:flex-none"
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
                // The browser's autofill dropdown has no place over a chat:
                // it floats old one-word messages ("hi", "hello") between the
                // person and the conversation they are typing into.
                autoComplete="off"
                placeholder="Ask anything about your money…"
                className="min-w-0 flex-1 border-0 bg-transparent font-sans text-[15px] text-foreground outline-none placeholder:text-faint disabled:opacity-60"
              />
              {dictation.supported && (
                <Button
                  type="button"
                  size="icon"
                  variant={dictation.listening ? 'default' : 'ghost'}
                  aria-label={dictation.listening ? 'Stop dictating' : 'Dictate your question'}
                  aria-pressed={dictation.listening}
                  onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                  disabled={sending}
                  className="h-[38px] w-[38px] flex-none rounded-[10px]"
                >
                  {dictation.listening ? (
                    <Square className="h-4 w-4" aria-hidden />
                  ) : (
                    <Mic className="h-[18px] w-[18px]" aria-hidden />
                  )}
                </Button>
              )}
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

        {/* Approvals + limits. A column on a desktop, a sheet on a phone. */}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click closes on backdrop only; Escape is the dialog's own. */}
        <dialog
          ref={panelsRef}
          className="agent-panels flex flex-col gap-[18px] bg-transparent text-foreground"
          aria-label="Approvals and limits"
          onClose={() => setPanelsOpen(false)}
          onClick={(e) => {
            if (e.target === panelsRef.current) closePanels();
          }}
        >
          <button
            type="button"
            data-sheet-handle
            onClick={closePanels}
            aria-label="Close approvals and limits"
            className="app-sheet__handle agent-panels__handle"
          />
          <div className="agent-panels__bar">
            <span className="font-display text-base font-bold">Approvals and limits</span>
            <Button type="button" size="sm" variant="ghost" onClick={closePanels}>
              Done
            </Button>
          </div>
          {/*
            What the agent prepared in this conversation.

            It sits above the approvals panel because that is the order things
            happen in: the agent proposes, you decide whether it is worth
            raising, and only then does it become a card waiting on you. A
            blocked verdict is shown too — the guardrail refusing a move, with
            its reasons, is the product doing its job rather than an error.
          */}
          {proposals.length > 0 && (
            <Card className="p-5">
              <div className="mb-3.5 flex items-center gap-2.5">
                <span className={cn(UPPR, 'text-foreground')}>Prepared by your agent</span>
              </div>
              <div className="flex flex-col gap-3">
                {proposals.map((p) => (
                  <div
                    key={p.instrumentId}
                    className="rounded-xl border border-solid border-border p-3.5"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <b className="text-[14.5px]">{p.name}</b>
                      <b className="font-mono text-[14.5px]">{p.amount}</b>
                    </div>
                    <p className="mt-1 text-[13px] leading-snug text-dim">{p.summary}</p>
                    {p.reasons.length > 0 && (
                      <ul className="mt-1.5 mb-0 list-disc pl-4 text-[12.5px] text-faint">
                        {p.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                    <TrustNote className="mt-2" />
                    {p.decision === 'blocked' ? (
                      <p className="mt-2 mb-0 text-[12.5px] font-semibold text-terra-ink">
                        Your agent will not prepare this.
                      </p>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-2.5"
                        disabled={raisingId === p.instrumentId}
                        onClick={async () => {
                          setRaisingId(p.instrumentId);
                          setRaiseError(null);
                          setRaiseNote(null);
                          try {
                            await createApproval({
                              instrumentId: p.instrumentId,
                              // The engine worked in minor units; the display
                              // string is for reading, not for reparsing.
                              amountMinor: p.amountMinor,
                              title: `${p.name} · ${p.amount}`,
                              body: p.summary,
                              // The engine's own case rides along and becomes
                              // the card's "How this was decided" trace.
                              summary: p.summary,
                              reasons: p.reasons,
                            });
                            setProposals((list) =>
                              list.filter((x) => x.instrumentId !== p.instrumentId),
                            );
                            const { approvals: rows } = await getApprovals();
                            setApprovals(rows.filter((a) => a.status === 'pending'));
                          } catch (err) {
                            if (err instanceof AlreadyPendingError) {
                              // Information, not failure: the card exists, so
                              // point at it and clear this duplicate offer.
                              setRaiseNote('Already in your approvals. Decide that card first.');
                              setProposals((list) =>
                                list.filter((x) => x.instrumentId !== p.instrumentId),
                              );
                              try {
                                const { approvals: rows } = await getApprovals();
                                setApprovals(rows.filter((a) => a.status === 'pending'));
                              } catch {
                                // The note stands; the realtime channel will
                                // catch the list up.
                              }
                            } else {
                              setRaiseError(
                                err instanceof Error
                                  ? err.message
                                  : 'Could not raise that for approval.',
                              );
                            }
                          } finally {
                            setRaisingId(null);
                          }
                        }}
                      >
                        {raisingId === p.instrumentId ? 'Raising…' : 'Send to my approvals'}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {raiseError && <InlineError>{raiseError}</InlineError>}
            </Card>
          )}

          {/* Outside the proposals card: raising the last proposal unmounts
              that card, and this note must outlive it to be read at all. */}
          {raiseNote && (
            <p
              className="m-0 flex items-center gap-2 rounded-xl bg-mint/60 px-3.5 py-2.5 text-[13px] text-foreground dark:bg-white/[0.05]"
              aria-live="polite"
            >
              <Info className="h-4 w-4 flex-none text-teal2" aria-hidden />
              {raiseNote}
            </p>
          )}

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
              <SkeletonRegion
                label="Loading approvals waiting on you"
                className="flex flex-col gap-3"
              >
                <SkeletonCard lines={3} />
                <SkeletonCard lines={3} />
              </SkeletonRegion>
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
                // "Name · US$2,010" splits into a headline and the figure the
                // decision is actually about; a title without the pattern
                // renders whole, as before.
                const split = splitApprovalTitle(a.title);
                // "How this was decided": the pipeline's own stage records,
                // stored on the approval when it was raised, drawn by the same
                // TraceDisplay the chat uses. Absent on cards from before the
                // pipeline existed — then no claim is rendered, rather than a
                // reconstructed one.
                const trace = decisionTrace(a.snapshot);
                const { firm, regulator } = snapshotFirm(a.snapshot);
                const scores = trace ? extractTraceScores(trace) : [];
                const execFirm = traceFirm(trace);
                const execMark = execFirm ? markFor(marks, { name: execFirm }) : undefined;
                const riskWord = a.body
                  ? (RISK_IN_BODY.exec(a.body)?.[1]?.toLowerCase() ?? null)
                  : null;
                const cased = a.body ? condenseBody(a.body) : null;
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

                    {/* Instrument as the headline, the amount as the figure the
                        reader is deciding on — large, with a quiet "proposed"
                        so it never reads as money already moved. */}
                    {split ? (
                      <div className="mb-2.5">
                        <div className="text-[15px] font-bold leading-snug">{split.name}</div>
                        <div className="mt-1.5 flex items-baseline gap-2">
                          <span className="font-display text-[27px] font-bold leading-none tracking-[-0.5px] text-teal2">
                            {split.amount}
                          </span>
                          <span className="text-[11px] font-bold uppercase tracking-[.5px] text-faint">
                            proposed
                          </span>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mb-1.5 text-[15px] font-bold">{a.title}</div>
                        {a.amountMinor !== null && (
                          <p className="mb-2.5 font-mono text-[13.5px] font-bold text-teal2">
                            {formatMoney(a.amountMinor, a.currency)}
                          </p>
                        )}
                      </>
                    )}

                    {/* Fact chips — each rendered only when its data actually
                        exists on this card, never a placeholder. */}
                    {(riskWord || scores.length > 0 || execFirm) && (
                      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                        {riskWord && <RiskBadge risk={riskWord} />}
                        {scores.map((s) => (
                          <Badge key={s.label} variant="secondary" className="font-mono">
                            {SCORE_CHIP_LABEL[s.label] ?? s.label} {s.score}/100
                          </Badge>
                        ))}
                        {execFirm && (
                          <span className="flex items-center gap-1.5 rounded-full border border-solid border-border bg-card py-0.5 pl-1 pr-2.5 text-[12px] font-semibold text-dim">
                            <PartnerMark
                              name={execFirm}
                              code={execMark?.code}
                              id={execMark?.id}
                              hasLogo={execMark?.hasLogo}
                              color={execMark?.color}
                              tint={execMark?.tint}
                              size="sm"
                            />
                            {execFirm}
                          </span>
                        )}
                      </div>
                    )}

                    {/* The case, condensed: a sentence or two on the card, the
                        rest inside the disclosure below instead of a wall of
                        prose between the reader and the buttons. */}
                    {cased && (
                      <p className="mb-2.5 text-[13.5px] leading-normal text-dim">{cased.lead}</p>
                    )}

                    {trace ? (
                      <details className="mb-3 rounded-lg bg-muted/60 px-3 py-2">
                        <summary className="cursor-pointer text-[12.5px] font-bold text-dim">
                          How this was decided · {trace.length} stage
                          {trace.length === 1 ? '' : 's'}
                        </summary>
                        {cased?.rest && (
                          <p className="mb-0 mt-2 text-[12.5px] leading-snug text-dim">
                            {cased.rest}
                          </p>
                        )}
                        <div className="mt-2">
                          <TraceDisplay trace={trace} />
                        </div>
                      </details>
                    ) : (
                      cased?.rest && (
                        <details className="mb-3 rounded-lg bg-muted/60 px-3 py-2">
                          <summary className="cursor-pointer text-[12.5px] font-bold text-dim">
                            Full reasoning
                          </summary>
                          <p className="mb-0 mt-1.5 text-[12.5px] leading-snug text-dim">
                            {cased.rest}
                          </p>
                        </details>
                      )
                    )}
                    <TrustNote className="mb-3" firm={firm} regulator={regulator} scores={scores} />
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

          {/* The full explainer lives on its own page — the chat's trace and
              trust disclosures show the pipeline per decision. The link rides
              in this column (and in the phone's sheet, where it is actually
              reachable — below the fixed full-screen chat it never was) so
              nothing sits under the grid to scroll the conversation away. */}
          <Link
            href="/how-it-works"
            className="flex items-center justify-between gap-2 rounded-xl border border-solid border-border bg-card px-4 py-3 text-[13.5px] font-semibold text-teal2 hover:bg-muted"
          >
            How your agent works
            <ArrowRight className="h-4 w-4 flex-none" aria-hidden />
          </Link>
        </dialog>
      </div>
    </AppScreen>
  );
}
