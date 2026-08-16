import { API_URL } from './config';

/**
 * Typed client for /api/agent/* and /api/approvals/*. Every request carries
 * `credentials: 'include'` so the Better Auth session cookie rides along —
 * CORS on the API is scoped to APP_WEB_ORIGIN with `credentials: true`, so
 * this is required, not optional. Money fields cross the wire as strings
 * (minor units) because Postgres bigint columns can't round-trip through
 * JSON as numbers; format them at the display boundary.
 *
 * POST /api/agent/message does NOT return JSON — it streams a reply as
 * Server-Sent Events (hono's `streamSSE`), so it can't use the JSON-fetch
 * helper below. `streamAgentMessage` reads `response.body` as a stream and
 * parses the SSE `event:`/`data:`/blank-line framing by hand, since the
 * browser `EventSource` API only supports GET and this is a POST.
 */

export type AgentRole = 'agent' | 'user';

export interface AgentMessage {
  role: AgentRole;
  content: string;
  createdAt: string;
}

export type ApprovalType = 'investment_rec' | 'fund_transfer' | 'plan_enrollment';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Approval {
  id: string;
  type: ApprovalType;
  status: ApprovalStatus;
  instrumentId: string | null;
  title: string;
  body: string | null;
  amountMinor: string | null;
  currency: string;
  snapshot: unknown;
  expiresAt: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface Order {
  id: string;
  userId: string;
  partnerId: string;
  instrumentId: string | null;
  approvalId: string | null;
  status: string;
  amountMinor: string;
  currency: string;
  idempotencyKey: string;
  clientRef: string | null;
  settlementEta: string | null;
  rejectedReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  settledAt: string | null;
}

/** The gate is re-run on approval, so "blocked" is an expected outcome, not a transport error. */
export type ApproveResult =
  | { decision: 'created'; order: Order }
  | { decision: 'blocked'; code: string; reasons: string[] };

export class AgentApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AgentApiError';
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
    throw new AgentApiError(message, res.status);
  }
  return body as T;
}

export function getAgentHistory(): Promise<{ messages: AgentMessage[] }> {
  return apiFetch('/api/agent/history');
}

export function getApprovals(): Promise<{ approvals: Approval[] }> {
  return apiFetch('/api/approvals');
}

/**
 * Approve re-runs the Limits Engine gate server-side; a re-gate that now
 * blocks the proposal comes back as `{ decision: 'blocked', ... }` on a 409,
 * same status as other rejected requests. Parse the body first and only
 * treat it as a transport error when it isn't a recognized decision shape,
 * so a block surfaces its reasons instead of collapsing into a generic
 * AgentApiError.
 */
export async function approveApproval(id: string, idempotencyKey?: string): Promise<ApproveResult> {
  const res = await fetch(`${API_URL}/api/approvals/${id}/approve`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(idempotencyKey ? { idempotencyKey } : {}),
  });
  const body = await res.json().catch(() => ({}));
  if (body && (body.decision === 'created' || body.decision === 'blocked')) {
    return body as ApproveResult;
  }
  const message = typeof body?.error === 'string' ? body.error : `request failed (${res.status})`;
  throw new AgentApiError(message, res.status);
}

export function rejectApproval(id: string, reason?: string): Promise<{ ok: true }> {
  return apiFetch(`/api/approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  });
}

/**
 * A move the agent prepared and the Limits Engine ruled on.
 *
 * The agent has no tool that can create an order, an approval or a transfer —
 * that boundary is asserted on every turn — so a proposal arrives here as
 * something to show a person, never as something already done. Raising the
 * approval card takes a human tap, and approving it takes a second one.
 */
export interface AgentProposal {
  instrumentId: string;
  name: string;
  /** Pre-formatted by @ccn/money server-side, e.g. "US$2,500". */
  amount: string;
  /** The same amount in minor units — what an approval is raised with. */
  amountMinor: string;
  decision: 'auto_act' | 'requires_approval' | 'blocked';
  code: string;
  reasons: string[];
  summary: string;
}

/**
 * Structured tool results the chat renders as inline visual cards. Every
 * number inside them was computed server-side by the pure agent context
 * (packages/agent/src/context.ts) — the model narrates them but cannot invent
 * them, which is why the client draws from this channel and never from prose.
 */

/** One allocation slice, chart-ready: pct is a real number a bar is drawn from. */
export interface AllocationSlice {
  key: string;
  label: string;
  /** Minor units as a string — bigints don't survive JSON. */
  valueMinor: string;
  /** Pre-formatted by @ccn/money server-side. */
  value: string;
  pct: number;
}

export interface AllocationTypeSlice extends AllocationSlice {
  targetPct: number;
  /** Positive = under target, negative = over. */
  gapPts: number;
}

export interface AllocationDisplayData {
  currency: string;
  total: string;
  band: string;
  /** Always all six mix keys, held or not — a 0% row with a target IS the gap. */
  byType: AllocationTypeSlice[];
  byPartner: AllocationSlice[];
  byCurrency: AllocationSlice[];
}

export interface GoalDisplay {
  name: string;
  target: string;
  current: string;
  targetMinor: string;
  currentMinor: string;
  /** Funded percentage, 0-100. */
  pct: number;
  eta: string | null;
}

export interface GoalsDisplayData {
  goals: GoalDisplay[];
}

export interface ComparisonRowDisplay {
  instrumentId: string;
  name: string;
  type: string;
  region: string | null;
  risk: string;
  metricLabel: string | null;
  metric: string | null;
  minimum: string;
  partner: string | null;
  regulator: string | null;
  suitable: boolean;
  fitScore: number;
  topReason: string | null;
  topConcern: string | null;
}

export interface ComparisonDisplayData {
  rows: ComparisonRowDisplay[];
}

export interface FitDisplayData {
  instrumentId: string;
  name: string;
  /** 0-100. */
  score: number;
  reasons: string[];
  concerns: string[];
}

export interface TraceStageDisplay {
  stage: string;
  agent: string;
  summary: string;
  detail: string[];
}

export interface PipelineDisplayData {
  trace: TraceStageDisplay[];
  proposal: {
    instrumentId: string;
    name: string;
    partner: string | null;
    amount: string;
    decision: string;
  } | null;
}

export type AgentDisplayKind = 'allocation' | 'goals' | 'comparison' | 'fit' | 'pipeline';

export type AgentDisplayData =
  | { kind: 'allocation'; data: AllocationDisplayData }
  | { kind: 'goals'; data: GoalsDisplayData }
  | { kind: 'comparison'; data: ComparisonDisplayData }
  | { kind: 'fit'; data: FitDisplayData }
  | { kind: 'pipeline'; data: PipelineDisplayData };

/** The kinds this client knows how to draw. Anything else is dropped, not crashed on. */
const DISPLAY_KINDS: ReadonlySet<string> = new Set([
  'allocation',
  'goals',
  'comparison',
  'fit',
  'pipeline',
]);

export interface StreamAgentMessageCallbacks {
  /** Called for each text chunk as it arrives, in order — append, don't replace. */
  onDelta: (delta: string) => void;
  /** Called exactly once when the stream ends, success or failure. Stop any "thinking" indicator here. */
  onDone: () => void;
  /** Called if the upstream agent fails mid-stream, or the request/transport itself fails. */
  onError: (message: string) => void;
  /** Called for each move the agent prepared this turn, after the text. */
  onProposal?: (proposal: AgentProposal) => void;
  /** Called for each visual card the turn produced, after the text. */
  onDisplay?: (display: AgentDisplayData) => void;
}

const DEFAULT_STREAM_ERROR = 'the agent is temporarily unavailable';

/** Parsed form of one SSE frame (the text between blank-line separators). */
interface SseFrame {
  event: string;
  data: string;
}

/**
 * Split raw SSE text on the blank-line frame separator, returning complete
 * frames and any trailing partial text that hasn't seen its separator yet.
 * Handles both `\n\n` and `\r\n\r\n` since the fetch stream may deliver
 * either line ending.
 */
function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  const separator = /\r?\n\r?\n/;
  let match = separator.exec(rest);
  while (match) {
    frames.push(rest.slice(0, match.index));
    rest = rest.slice(match.index + match[0].length);
    match = separator.exec(rest);
  }
  return { frames, rest };
}

/** Parse one SSE frame's `event:`/`data:` lines into an { event, data } pair. */
function parseSseFrame(rawFrame: string): SseFrame | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const rawLine of rawFrame.split(/\r?\n/)) {
    if (rawLine.startsWith('event:')) {
      event = rawLine.slice(6).trim();
    } else if (rawLine.startsWith('data:')) {
      dataLines.push(rawLine.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

/**
 * POST /api/agent/message and manually parse the SSE response body — this
 * can't use the browser `EventSource` API since that only supports GET, and
 * this endpoint is a POST with a JSON body. Recognized events:
 *   - "message" (the default, no explicit `event:` line): data is
 *     `{"delta": "..."}` — one text chunk, appended via onDelta.
 *   - "proposal": data is an AgentProposal — a move the agent prepared, which
 *     the screen offers as a card the reader can send to their approvals.
 *   - "display": data is `{"kind": ..., "data": ...}` — a tool result the chat
 *     renders as an inline visual card. Kinds this build doesn't recognize are
 *     ignored so an older client survives a newer server.
 *   - "error": data is `{"error": "..."}` — upstream failure, via onError.
 *   - "done": data is the literal string `[DONE]` (not JSON) — end of stream.
 * The server always sends a final "done" event, including right after an
 * "error" event, so callers can rely on onDone alone to clear a "thinking"
 * indicator. As a defensive fallback (network drop, proxy truncation) this
 * function still calls onDone itself if the stream ends without one.
 */
export async function streamAgentMessage(
  message: string,
  { onDelta, onDone, onError, onProposal, onDisplay }: StreamAgentMessageCallbacks,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/agent/message`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  } catch {
    onError(DEFAULT_STREAM_ERROR);
    onDone();
    return;
  }

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    const msg = typeof body?.error === 'string' ? body.error : DEFAULT_STREAM_ERROR;
    onError(msg);
    onDone();
    return;
  }

  let sawDone = false;
  const handleFrame = (rawFrame: string) => {
    const frame = parseSseFrame(rawFrame);
    if (!frame) return;
    if (frame.event === 'error') {
      try {
        const parsed = JSON.parse(frame.data) as { error?: string };
        onError(parsed.error ?? DEFAULT_STREAM_ERROR);
      } catch {
        onError(DEFAULT_STREAM_ERROR);
      }
      return;
    }
    if (frame.event === 'proposal') {
      try {
        const parsed = JSON.parse(frame.data) as AgentProposal;
        if (parsed && typeof parsed.instrumentId === 'string') onProposal?.(parsed);
      } catch {
        // A malformed proposal frame costs a card, not the answer above it.
      }
      return;
    }
    if (frame.event === 'display') {
      try {
        const parsed = JSON.parse(frame.data) as { kind?: unknown; data?: unknown };
        if (
          parsed &&
          typeof parsed.kind === 'string' &&
          DISPLAY_KINDS.has(parsed.kind) &&
          parsed.data !== undefined &&
          parsed.data !== null
        ) {
          onDisplay?.(parsed as AgentDisplayData);
        }
        // An unknown kind is a newer server talking past this build — the
        // text above the card still stands, so drop the card silently.
      } catch {
        // Malformed display frame — same deal: lose the chart, keep the answer.
      }
      return;
    }
    if (frame.event === 'done') {
      // data is the literal string "[DONE]", not JSON — nothing to parse.
      sawDone = true;
      onDone();
      return;
    }
    try {
      const parsed = JSON.parse(frame.data) as { delta?: string };
      if (typeof parsed.delta === 'string') onDelta(parsed.delta);
    } catch {
      // Malformed frame — ignore rather than surfacing a spurious error mid-stream.
    }
  };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const frame of frames) handleFrame(frame);
    }
    if (buffer.trim().length > 0) handleFrame(buffer);
  } catch {
    if (!sawDone) onError(DEFAULT_STREAM_ERROR);
  } finally {
    if (!sawDone) onDone();
  }
}

/**
 * Raise an approval card from a proposal the agent prepared.
 *
 * `POST /api/approvals` has existed since the approval routes were written and
 * nothing called it. The only writer of an approval row was the demo seed, which
 * runs for addresses in DEMO_CUSTOMER_EMAILS — so the loop the whole product is
 * built around, and which the approvals panel on this screen exists to serve,
 * could not occur for any real account.
 *
 * A person raises the card, and a person then approves it. Two taps, two
 * decisions, and the agent holds neither: its tool set cannot write, and the
 * approve path re-runs the Limits Engine before an order is created.
 */

/**
 * A pending card already exists for this instrument — the server refused to
 * stack a second one (409 `already_pending`). This is information, not
 * failure: the caller should point the person at the card that exists, not
 * paint an error. Carries that existing card when the server sent it.
 */
export class AlreadyPendingError extends Error {
  approval: Approval | null;
  constructor(approval: Approval | null) {
    super('This is already waiting in your approvals.');
    this.name = 'AlreadyPendingError';
    this.approval = approval;
  }
}

export async function createApproval(input: {
  instrumentId: string;
  amountMinor: string;
  title: string;
  body?: string;
  /** The proposal's own case — becomes the card's one-stage trace server-side. */
  summary?: string;
  reasons?: string[];
}): Promise<{ approval: { id: string } }> {
  const res = await fetch(`${API_URL}/api/approvals`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, type: 'investment_rec' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 409 && body?.error === 'already_pending') {
      throw new AlreadyPendingError(
        body.approval && typeof body.approval === 'object' ? (body.approval as Approval) : null,
      );
    }
    throw new AgentApiError(
      typeof body?.error === 'string' ? body.error : 'Could not raise that for approval.',
      res.status,
    );
  }
  return body;
}
