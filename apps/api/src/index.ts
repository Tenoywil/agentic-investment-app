import { describe, loadServerConfig } from '@ccn/config';
import { createDb } from '@ccn/db';
import { sql } from 'drizzle-orm';
import { createApp } from './app';
import { createAuth, resolveAuthBaseUrl } from './auth';
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

/**
 * State the effective auth wiring once, at boot.
 *
 * Every auth failure this project has had was a configuration mismatch producing a
 * correct-looking 401 and no clue which of four values was wrong. These are
 * public origins — they are visible in the browser already — so logging them
 * costs nothing and turns "sign-in is broken" into one readable line.
 */
{
  const { baseURL, overridden } = resolveAuthBaseUrl(config);
  logger.info('auth configuration', {
    baseURL,
    webOrigin: config.APP_WEB_ORIGIN,
    googleRedirectUri: `${baseURL}/api/auth/callback/google`,
    betterAuthUrlEnv: config.BETTER_AUTH_URL,
    overriddenToWebOrigin: overridden,
  });
  if (overridden) {
    logger.error(
      'BETTER_AUTH_URL does not match APP_WEB_ORIGIN; using APP_WEB_ORIGIN. The browser is always on the web origin because /api/* is proxied, so the callback and cookie must belong to it. Update BETTER_AUTH_URL, and make sure the Google OAuth client lists the redirect URI logged above.',
      { betterAuthUrl: config.BETTER_AUTH_URL, using: baseURL },
    );
  }
}

/**
 * Prove, at boot, that the API can do the one thing every authenticated request
 * begins with: drop into the application role.
 *
 * `withRls` opens each request transaction with `SET LOCAL ROLE`, which
 * PostgreSQL refuses unless the connecting role is a MEMBER of the target. When
 * it is refused the failure surfaces as a 500 on a real user's first request,
 * with the cause buried in a driver stack trace — which is how it reached
 * production. Checking here turns a mystery 500 into a startup line naming the
 * role and the grant to run.
 *
 * It does not exit: a running API that can still serve /health and the auth
 * routes is more useful than one that refuses to start, and the log says
 * plainly what is broken.
 */
{
  const role = config.DB_APP_ROLE;
  try {
    const [who] = (await db.execute('select current_user as who')) as unknown as [{ who: string }];
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(`SET LOCAL ROLE ${role}`));
    });
    logger.info('database role check passed', { connectsAs: who.who, canSetRole: role });
  } catch (error) {
    logger.error(
      `cannot SET ROLE ${role}; every authenticated request will fail with 500. Grant it once as a role with ADMIN OPTION (in Supabase, the SQL Editor runs as postgres): GRANT ${role} TO <the user in DATABASE_URL>;`,
      { error, dbAppRole: role },
    );
  }
}

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
