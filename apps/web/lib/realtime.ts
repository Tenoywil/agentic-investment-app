import { API_URL } from './config';

/**
 * The product's realtime connection.
 *
 * The API has published order transitions to a Postgres `LISTEN ccn_events`
 * channel, fanned them out to authorised sockets, and tested the whole path end
 * to end since the hub was written. Nothing in the web app ever connected to it.
 * Every screen fetched once on mount and then froze: an investor watched an
 * order sit at "Routed" while their institution had already settled it, and an
 * operator's queue stayed empty while requests arrived, because neither page had
 * any reason to ask again.
 *
 * ## Why Server-Sent Events and not the WebSocket
 *
 * The API offers both. The browser can only use this one. Every authenticated
 * request must be same-origin or the Better Auth session cookie is third-party
 * and is never sent — the failure documented at length in `./config.ts`, which
 * took down production once — and same-origin means travelling through the web
 * app's `/api/:path*` rewrite. An HTTP rewrite forwards a request and a
 * response; it does not carry an `Upgrade` handshake, so a WebSocket cannot go
 * through it, and a WebSocket that goes around it arrives without a session.
 * SSE is ordinary HTTP streaming, so it proxies like anything else. The
 * WebSocket endpoint remains for a client that can hold its own credential.
 *
 * ## Why every subscriber refetches on connect
 *
 * `hub.dispatch` writes to the sockets connected at that instant and keeps no
 * replay buffer, so an event fired while the browser was between connections is
 * gone. Treating the stream as the source of truth would therefore be wrong in
 * exactly the case that matters — a laptop reopened after lunch. The stream is
 * used only as a signal that something changed; the screen then reloads its own
 * data from the API, which is authoritative. That also makes `onChange` safe to
 * implement as a plain refetch, and makes a missed event cost one stale render
 * rather than a permanently wrong screen.
 */

/** The envelope `pg_notify` sends and `ws/hub.ts` fans out. */
export interface CcnEvent {
  /** `order.created`, `approval.insert`, `connection.update`, … */
  type: string;
  order_id?: string;
  user_id?: string | null;
  partner_id?: string | null;
  status?: string;
}

/**
 * What a screen cares about, as a list of `type` prefixes. `['order']` matches
 * `order.created` and `order.settled`; `[]` matches everything.
 */
export type Topics = readonly string[];

export interface Subscription {
  /** Something in one of your topics changed. Refetch. */
  onChange: (event: CcnEvent) => void;
  /**
   * The stream (re)connected, so anything that happened while it was down was
   * missed. Refetch. Called on the first connect too, which is harmless: the
   * screen has just fetched, and one duplicate read is cheaper than a special
   * case that gets the reconnect wrong.
   */
  onResync?: () => void;
}

interface Registration extends Subscription {
  topics: Topics;
}

const registrations = new Set<Registration>();
let source: EventSource | null = null;
/**
 * Consecutive connection failures. EventSource retries on its own after a
 * dropped connection, but a response it cannot use at all — a 401 from an
 * expired session — makes it retry forever against a door that will not open.
 */
let failures = 0;
const MAX_FAILURES = 5;

function matches(topics: Topics, type: string): boolean {
  if (topics.length === 0) return true;
  return topics.some((t) => type === t || type.startsWith(`${t}.`));
}

function open(): void {
  if (source || typeof window === 'undefined') return;

  const stream = new EventSource(`${API_URL}/api/sse`, { withCredentials: true });
  source = stream;

  stream.onopen = () => {
    failures = 0;
    for (const r of registrations) r.onResync?.();
  };

  stream.onmessage = (message) => {
    let event: CcnEvent;
    try {
      event = JSON.parse(message.data) as CcnEvent;
    } catch {
      return; // a malformed frame must not take the connection down
    }
    if (typeof event.type !== 'string') return;
    for (const r of registrations) {
      if (matches(r.topics, event.type)) r.onChange(event);
    }
  };

  stream.onerror = () => {
    failures += 1;
    if (failures >= MAX_FAILURES) {
      // Give up rather than reconnect in a loop nobody can see. The screens
      // still work; they are simply back to being as fresh as their last fetch,
      // which is what they were before this file existed.
      stream.close();
      if (source === stream) source = null;
    }
  };
}

function close(): void {
  source?.close();
  source = null;
  failures = 0;
}

/**
 * Listen for changes. Returns an unsubscribe function — call it from an effect's
 * cleanup. The connection is shared: it opens on the first subscriber and closes
 * when the last one leaves, so a screen with four panels holds one stream, not
 * four.
 */
export function subscribe(topics: Topics, handlers: Subscription): () => void {
  const registration: Registration = { topics, ...handlers };
  registrations.add(registration);
  open();

  return () => {
    registrations.delete(registration);
    if (registrations.size === 0) close();
  };
}
