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

export interface StreamAgentMessageCallbacks {
  /** Called for each text chunk as it arrives, in order — append, don't replace. */
  onDelta: (delta: string) => void;
  /** Called exactly once when the stream ends, success or failure. Stop any "thinking" indicator here. */
  onDone: () => void;
  /** Called if the upstream agent fails mid-stream, or the request/transport itself fails. */
  onError: (message: string) => void;
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
 *   - "error": data is `{"error": "..."}` — upstream failure, via onError.
 *   - "done": data is the literal string `[DONE]` (not JSON) — end of stream.
 * The server always sends a final "done" event, including right after an
 * "error" event, so callers can rely on onDone alone to clear a "thinking"
 * indicator. As a defensive fallback (network drop, proxy truncation) this
 * function still calls onDone itself if the stream ends without one.
 */
export async function streamAgentMessage(
  message: string,
  { onDelta, onDone, onError }: StreamAgentMessageCallbacks,
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
