import { createCachedResearch } from '@ccn/agent';
import { demoCustomerAllowlist, describe, loadServerConfig, operatorAllowlist } from '@ccn/config';
import { createDb } from '@ccn/db';
import { sql } from 'drizzle-orm';
import { createApp } from './app';
import { createAuth, resolveAuthBaseUrl } from './auth';
import { createLogger } from './logger';
import { checkMigrations } from './migrations';
import { createFieldCipherFrom, createOutboundGuard } from './security';
import { startAgentSweep } from './services/agent-sweep';
import {
  createPartnerWebhookAdminRuntime,
  createPartnerWebhookDispatcherDeps,
  startPartnerWebhookDispatcher,
} from './services/partner-webhooks';
import { startValueSnapshots } from './services/value-snapshots';
import { resolveTenant } from './tenant';
import { startEventBridge } from './ws/bridge';
import { type Registration, WsHub } from './ws/hub';
import { handleSse } from './ws/sse';

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
const kycFieldCipher = createFieldCipherFrom(config);
const deps = { db, auth, config, logger, kycFieldCipher };
const partnerWebhooks = createPartnerWebhookAdminRuntime(config);
const app = createApp(deps, { partnerWebhooks, kycFieldCipher });

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

/**
 * Say, at boot, whether this database has the migrations this code needs.
 *
 * Render cannot apply them on the free plan, so a person does it after every
 * merge that adds one. That has been missed twice, and both times the first
 * report was a 500 in front of a user rather than a line anybody could have read
 * at deploy time. Like the checks around it, this does not exit — with the
 * degradation in services/fx.ts the product mostly keeps working, and an API
 * still serving /health and the auth routes beats one that refuses to start.
 */
await checkMigrations(deps);

/**
 * Say, at boot, whether anyone can reach the institution console.
 *
 * `PARTNER_OPERATOR_EMAILS` is the only path to the `partner_operator` role —
 * provisioning fails closed, so an address absent from it is granted `customer`
 * and lands on the investor dashboard. With the variable unset that is *every*
 * address, and the console is unreachable by anyone alive.
 *
 * Nothing said so. Signing in with the firm's account and arriving at the
 * customer screens looks like a broken redirect or a broken console, and both
 * were investigated as such before the cause — an unset environment variable —
 * was found. One line at boot names it.
 *
 * Like the checks around it, it does not exit: a deployment with no operators
 * is a perfectly valid customer-only deployment.
 */
{
  const operators = operatorAllowlist(config);
  const demoCustomers = demoCustomerAllowlist(config);
  if (operators.size === 0) {
    logger.warn(
      'PARTNER_OPERATOR_EMAILS is empty, so no account can reach the institution console. Every sign-in resolves to the customer surface. Set it to a comma-separated list of email or email:PARTNERCODE (e.g. ops@firm.com:SAG), then run `bun run grant` in apps/api to apply it to identities that have already signed in — provisioning only fires for a user who holds no role yet.',
      { demoCustomers: demoCustomers.size },
    );
  } else {
    logger.info('operator allowlist loaded', {
      operators: operators.size,
      partners: [...new Set([...operators.values()].map((g) => g.partnerCode ?? 'default'))],
      demoCustomers: demoCustomers.size,
    });
  }
}

/**
 * Prove, at boot, that the AI gateway is reachable and the key is accepted.
 *
 * The agent chat has exactly one path to text and no fallback, and when it fails
 * the user is told only that it is "temporarily unavailable". The agent-eval CI
 * gate does not cover this: its live-model evals are skipped when no gateway key
 * is configured, deliberately, so the gate never flakes on the network — which
 * means the live path can be broken with every check green.
 *
 * `/models` is the cheapest call that exercises both halves of the problem: it
 * fails on an unreachable host and 401s on a bad key, and it costs no tokens.
 * It goes through the same SSRF-guarded fetch the agent uses, so a host missing
 * from the allowlist fails here too rather than only under a real question.
 *
 * Like the role check above, it does not exit — the rest of the product works
 * without the agent — and it never logs the key.
 */
{
  const base = config.OPENAI_BASE_URL.replace(/\/+$/, '');
  const url = `${base}/models`;
  try {
    const res = await createOutboundGuard(config).fetch(url, {
      headers: { authorization: `Bearer ${config.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      logger.info('ai gateway check passed', { gateway: base, model: config.AI_MODEL });
    } else {
      // 401 is unambiguous. 403 is not: an OpenAI-compatible gateway returns it
      // for a key without access to the account or model, but so does any proxy
      // sitting between this process and the internet that refuses the host —
      // which is what a locked-down build environment looks like, and why this
      // does not assert the key is wrong.
      // The key has to belong to whoever is answering at OPENAI_BASE_URL, and
      // the model id has to be one that host actually serves. Both have been
      // wrong here before — first a MiniMax key against a gateway that had
      // never issued it, then a family name where an exact id was required —
      // and each reads like the other from the status code alone.
      const mismatch = `The key must have been issued by whoever answers at ${base}. For MiniMax, that is a key from platform.minimax.io and the international endpoint https://api.minimax.io/v1 — a China-platform key will not authenticate here. AI_MODEL must be an exact id from GET ${base}/models (e.g. MiniMax-M2), not a family name.`;
      const hint =
        res.status === 401
          ? `The key is being rejected. ${mismatch}`
          : res.status === 403
            ? `Either the key has no access to this gateway or model, or something between this process and the gateway refused the request. ${mismatch}`
            : 'Check OPENAI_BASE_URL points at an OpenAI-compatible gateway.';
      logger.error(
        `AI gateway answered ${res.status} for GET ${url}. The agent chat will fail for every user. ${hint}`,
        { gateway: base, status: res.status, model: config.AI_MODEL },
      );
    }
  } catch (error) {
    logger.error(
      `cannot reach the AI gateway at ${base}; the agent chat will fail for every user. This is a network or allowlist failure, not a bad key — the key is not checked until the host answers.`,
      { error, gateway: base, model: config.AI_MODEL },
    );
  }
}

const hub = new WsHub();
await startEventBridge(client, hub);

/**
 * The agent's background half: scan the live marketplace against each
 * investor's own limits and raise approval cards for what fits. The one part
 * of "discovers, screens and coordinates" that must not wait for a person to
 * open the chat. It proposes only — nothing moves money without an approval.
 *
 * The per-asset research pass is wired here and only here, and only when
 * enabled (AGENT_RESEARCH_TTL_MS > 0): one shared, TTL-cached dossier per
 * instrument on the `high` model tier, through the same SSRF-guarded fetch as
 * every other egress. A failed pass degrades the sweep to no research signal
 * — it never blocks a proposal and never fabricates one.
 */
const research =
  config.AGENT_RESEARCH_TTL_MS > 0
    ? createCachedResearch({
        ttlMs: config.AGENT_RESEARCH_TTL_MS,
        gateway: {
          baseURL: config.OPENAI_BASE_URL,
          apiKey: config.OPENAI_API_KEY,
          defaultModel: config.AI_MODEL,
          models: {
            high: config.GATEWAY_MODEL_HIGH,
            general: config.GATEWAY_MODEL_GENERAL,
            low: config.GATEWAY_MODEL_LOW,
          },
          fetch: createOutboundGuard(config).fetch,
        },
        onError: (facts, error) =>
          logger.warn('instrument research failed; the sweep degrades to no signal', {
            instrument: facts.name,
            error,
          }),
      })
    : undefined;
startAgentSweep({ ...deps, research });

/**
 * The valuation recorder: once a day, one net-worth row per investor and one
 * held-by-clients row per firm — the honest history behind every equity
 * chart. Same composition-root-only, same kill switch as the sweep.
 */
startValueSnapshots(deps);

/**
 * At-least-once export of partner audit events. An empty deployment allowlist
 * is the explicit off switch; no cipher or outbound client is constructed in
 * that state, which keeps webhook configuration optional and fail-closed.
 */
if (config.PARTNER_WEBHOOK_ALLOWED_HOSTS.length === 0) {
  logger.info('partner webhook dispatcher disabled (no approved hosts)');
} else {
  startPartnerWebhookDispatcher(createPartnerWebhookDispatcherDeps(config, db, logger));
}

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
    //
    // Not reachable from the browser, and deliberately so. Every API call must be
    // same-origin or the Better Auth cookie is third-party and never sent (see
    // apps/web/lib/config.ts), which means going through the web app's
    // `/api/:path*` rewrite — and an HTTP rewrite does not carry an `Upgrade`
    // handshake. This endpoint is for a client that can hold its own credential:
    // a native app, or an operator tool. Browsers use /api/sse below, which is
    // ordinary HTTP streaming and proxies fine.
    if (url.pathname === '/ws') {
      const tenant = await resolveTenant(deps, req.headers);
      if (!tenant) return new Response('unauthorized', { status: 401 });
      const data: WsData = { userId: tenant.user.id, partnerId: tenant.partnerId };
      return srv.upgrade(req, { data })
        ? undefined
        : new Response('upgrade failed', { status: 500 });
    }

    // The browser's realtime transport. Under /api/ so the web app's rewrite
    // forwards it and the session cookie stays first-party. The handler lives in
    // ./ws/sse.ts so it can be tested; this is only the route.
    if (url.pathname === '/api/sse') return handleSse(deps, hub, req);

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
