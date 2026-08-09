import { describe, loadServerConfig } from '@ccn/config';
import { createDb } from '@ccn/db';
import { createApp } from './app';
import { createAuth } from './auth';
import { createLogger } from './logger';
import { resolveTenant } from './tenant';
import { startEventBridge } from './ws/bridge';
import { type Registration, WsHub } from './ws/hub';

/**
 * Composition root: validate config (fail-fast), open the DB pool, wire Better
 * Auth and the Hono app, then serve HTTP + WebSockets from one Bun process. A
 * single dedicated LISTEN connection bridges Postgres NOTIFY events to the hub,
 * which fans them out to each socket's own tenant (never cross-tenant).
 */
const config = loadServerConfig();
const { db, client } = createDb(config.DATABASE_URL);
const auth = createAuth(db, config);
const logger = createLogger({
  level: config.APP_ENV === 'development' ? 'debug' : 'info',
  base: { service: 'ccn-api', env: config.APP_ENV },
});
const deps = { db, auth, config, logger };
const app = createApp(deps);

const hub = new WsHub();
await startEventBridge(client, hub);

/** Per-connection state: the tenant (fixed at upgrade) and its hub registration. */
interface WsData {
  userId: string;
  partnerId?: string | undefined;
  entry?: Registration;
}

const server = Bun.serve<WsData>({
  port: config.PORT,
  async fetch(req, srv) {
    const url = new URL(req.url);

    // WebSocket upgrade — validate the session, pin the tenant onto the socket.
    if (url.pathname === '/ws') {
      const tenant = await resolveTenant(deps, req.headers);
      if (!tenant) return new Response('unauthorized', { status: 401 });
      const data: WsData = { userId: tenant.user.id, partnerId: tenant.partnerId };
      return srv.upgrade(req, { data })
        ? undefined
        : new Response('upgrade failed', { status: 500 });
    }

    // SSE fallback — same events, for networks that block WebSockets.
    if (url.pathname === '/sse') {
      const tenant = await resolveTenant(deps, req.headers);
      if (!tenant) return new Response('unauthorized', { status: 401 });
      const sub = { userId: tenant.user.id, partnerId: tenant.partnerId };
      let entry: Registration | null = null;
      const stream = new ReadableStream({
        start(controller) {
          const enc = new TextEncoder();
          entry = hub.add({ send: (d) => controller.enqueue(enc.encode(`data: ${d}\n\n`)) }, sub);
        },
        cancel() {
          if (entry) hub.remove(entry);
        },
      });
      return new Response(stream, {
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        },
      });
    }

    return app.fetch(req, srv);
  },
  websocket: {
    open(ws) {
      ws.data.entry = hub.add(ws, { userId: ws.data.userId, partnerId: ws.data.partnerId });
    },
    close(ws) {
      if (ws.data.entry) hub.remove(ws.data.entry);
    },
    message() {
      // Clients are receive-only; inbound frames are ignored.
    },
  },
});

console.log(`CCN API on :${server.port} (${config.APP_ENV})`, describe(config));
