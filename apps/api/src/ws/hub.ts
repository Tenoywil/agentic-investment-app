/**
 * The realtime hub. A single Postgres `LISTEN ccn_events` connection (see
 * ./bridge.ts) feeds every order/approval transition here; the hub fans each
 * event out only to the sockets whose tenant it belongs to. Subscriber identity
 * is fixed at connection time from a validated session — a socket can never
 * subscribe itself to another tenant's stream (WS channel-leakage defense).
 */

/** A `pg_notify('ccn_events', …)` payload (see the order state functions). */
export interface CcnEvent {
  type: string;
  order_id?: string;
  user_id?: string | null;
  partner_id?: string | null;
  status?: string;
}

/** The tenant a connection belongs to, resolved from its session at upgrade. */
export interface Subscriber {
  userId: string;
  partnerId?: string | undefined;
}

/** Anything that can receive a serialized event (a WebSocket or an SSE writer). */
export interface Sink {
  send(data: string): void;
}

/**
 * Tenant match: a subscriber receives an event iff it is the event's user OR the
 * event's partner. Empty ids never match (an event with no partner never leaks to
 * partner operators, and vice versa).
 */
export function shouldReceive(sub: Subscriber, ev: CcnEvent): boolean {
  if (ev.user_id && ev.user_id === sub.userId) return true;
  if (ev.partner_id && sub.partnerId && ev.partner_id === sub.partnerId) return true;
  return false;
}

export interface Registration {
  sub: Subscriber;
  sink: Sink;
}

export class WsHub {
  private readonly entries = new Set<Registration>();

  /** Register a connection; returns a handle to remove it on close. */
  add(sink: Sink, sub: Subscriber): Registration {
    const entry: Registration = { sink, sub };
    this.entries.add(entry);
    return entry;
  }

  remove(entry: Registration): void {
    this.entries.delete(entry);
  }

  /** Fan one event out to every matching subscriber; returns the delivery count. */
  dispatch(ev: CcnEvent): number {
    const payload = JSON.stringify(ev);
    let delivered = 0;
    for (const entry of this.entries) {
      if (shouldReceive(entry.sub, ev)) {
        entry.sink.send(payload);
        delivered += 1;
      }
    }
    return delivered;
  }

  size(): number {
    return this.entries.size;
  }
}
