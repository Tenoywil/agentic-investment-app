import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, user } from '@ccn/db';
import { eq } from 'drizzle-orm';
import { WsHub } from '../src/ws/hub';
import { handleSse } from '../src/ws/sse';

/**
 * The stream a browser actually reads.
 *
 * Both ends of the realtime path were already covered — the Postgres bridge and
 * the hub's tenant fan-out — and the piece in the middle, the one every screen
 * depends on, had no test at all: the SSE framing, the headers that stop a proxy
 * buffering a stream that never completes, and the 401 for a caller with no
 * session.
 *
 * Only the session lookup is stubbed. `resolveTenant` reads roles through a
 * real RLS transaction, so the database is real here too — stubbing it out
 * would have meant asserting against a tenant this API would never actually
 * produce. Whether a *cookie* resolves to a session is Better Auth's business
 * and is covered in auth-session.test.ts; whether a resolved session gets its
 * own events and only its own is this file's.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const handle = createDb(DATABASE_URL ?? '', { max: 2 });
const tag = `sse-${Date.now()}`;
let userId = '';

/** Just enough of AppDeps for `resolveTenant` and the response headers. */
function depsWith(session: { userId: string } | null) {
  return {
    config: {
      APP_WEB_ORIGIN: 'http://localhost:3000',
      DB_APP_ROLE: 'ccn_app',
      // resolveTenant provisions a role on first sight, and provisioning reads
      // the allowlists. Empty means "an ordinary customer", which is who this
      // stream is for.
      PARTNER_OPERATOR_EMAILS: '',
      DEMO_CUSTOMER_EMAILS: '',
      DEMO_PARTNER_CODE: 'SAG',
      ADMIN_EMAILS: '',
    },
    auth: {
      api: {
        getSession: async () =>
          session ? { user: { id: session.userId, email: `${tag}@x.com` }, session: {} } : null,
      },
    },
    db: handle.db,
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  } as never;
}

/** Read whatever the stream has produced so far, without waiting for it to end. */
async function drain(res: Response, ms = 150): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let out = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const next = await Promise.race([
      reader.read(),
      new Promise<null>((r) => setTimeout(() => r(null), 30)),
    ]);
    if (!next) continue;
    if (next.done) break;
    out += decoder.decode(next.value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return out;
}

suite('the SSE endpoint', () => {
  beforeAll(async () => {
    const [u] = await handle.db
      .insert(user)
      .values({ name: 'Marcus', email: `${tag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    userId = u?.id ?? '';
  });

  afterAll(async () => {
    await handle.db.delete(user).where(eq(user.id, userId));
    await handle.client.end();
  });

  test('refuses a caller with no session', async () => {
    const res = await handleSse(depsWith(null), new WsHub(), new Request('http://api/api/sse'));
    expect(res.status).toBe(401);
  });

  test('opens with the headers that keep a stream alive through a proxy', async () => {
    const hub = new WsHub();
    const res = await handleSse(depsWith({ userId }), hub, new Request('http://api/api/sse'));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    // `no-transform` and x-accel-buffering are not decoration: nginx and several
    // CDNs hold a response until it completes, and a stream that never completes
    // is then delivered as nothing at all.
    expect(res.headers.get('cache-control')).toContain('no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    // Served by Bun ahead of the Hono app, so the CORS middleware never sees it.
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');

    await drain(res, 60);
  });

  test('delivers an event to the subscriber it belongs to', async () => {
    const hub = new WsHub();
    const res = await handleSse(depsWith({ userId }), hub, new Request('http://api/api/sse'));

    // The handler registers on start, which runs when the stream is first read.
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    const first = await reader?.read();
    const opening = decoder.decode(first?.value);
    // A comment frame and a retry hint before anything else: EventSource ignores
    // both, and together they keep the connection open and reconnecting fast.
    expect(opening).toContain(': connected');

    hub.dispatch({ type: 'order.settled', user_id: userId, order_id: 'o1' });

    let payload = '';
    for (let i = 0; i < 5 && !payload.includes('order.settled'); i++) {
      const next = await reader?.read();
      payload += decoder.decode(next?.value);
    }
    expect(payload).toContain('data: ');
    expect(payload).toContain('order.settled');

    await reader?.cancel().catch(() => {});
  });

  test('never delivers another tenant’s event', async () => {
    const hub = new WsHub();
    const res = await handleSse(depsWith({ userId }), hub, new Request('http://api/api/sse'));
    const reader = res.body?.getReader();
    await reader?.read(); // open the stream so the subscriber registers

    // Somebody else's order, and a partner event this subscriber has no partner
    // for. Neither may appear on this connection.
    expect(hub.dispatch({ type: 'order.settled', user_id: 'someone-else' })).toBe(0);
    expect(hub.dispatch({ type: 'listing.insert', partner_id: 'p1' })).toBe(0);

    await reader?.cancel().catch(() => {});
  });

  test('unregisters when the client goes away', async () => {
    const hub = new WsHub();
    const res = await handleSse(depsWith({ userId }), hub, new Request('http://api/api/sse'));
    const reader = res.body?.getReader();
    await reader?.read();
    expect(hub.size()).toBe(1);

    await reader?.cancel();
    // Without this, every reconnect leaves a dead sink behind and the hub grows
    // for the life of the process.
    expect(hub.size()).toBe(0);
  });
});
