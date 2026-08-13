import type postgres from 'postgres';
import type { CcnEvent, WsHub } from './hub';

/**
 * Bridge Postgres `LISTEN ccn_events` to the hub. One dedicated connection
 * listens; every DB-side `pg_notify('ccn_events', json)` (emitted by
 * create_order / accept_order / settle_order / reject_order) is parsed and
 * dispatched to authorized sockets. Returns an unlisten function for shutdown.
 *
 * A malformed payload is dropped, not thrown — a bad notification must never take
 * the listener down.
 */
export async function startEventBridge(
  client: postgres.Sql,
  hub: WsHub,
): Promise<() => Promise<void>> {
  const listener = await client.listen('ccn_events', (payload) => {
    let ev: CcnEvent;
    try {
      ev = JSON.parse(payload) as CcnEvent;
    } catch {
      return;
    }
    hub.dispatch(ev);
  });
  return () => listener.unlisten();
}
