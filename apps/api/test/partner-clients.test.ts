import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import {
  connectedAccounts,
  createDb,
  holdings,
  kycStatus,
  partners,
  session,
  user,
  userRoles,
} from '@ccn/db';
import { eq, inArray } from 'drizzle-orm';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { createLogger } from '../src/logger';

/**
 * The partner accepts a client — both sides of it, over HTTP.
 *
 * This is the join between the two halves of the product, and until 0014 it did
 * not exist: an investor linked an account at a firm and the firm was never
 * told. The console's Clients tab showed a funnel of seeded counts and no
 * person, and there was no control anywhere that could admit or refuse one.
 *
 * Four properties are load-bearing, and each is a separate case below:
 *   * connecting requests, it does not help itself — nothing is read from a
 *     firm before an operator there has accepted the person;
 *   * the operator sees the KYC package CCN passes across, and only for people
 *     who linked an account at *their* firm;
 *   * accepting is what makes the holdings pullable;
 *   * declining is honest about it, and cannot be worked around by pressing
 *     Connect again.
 *
 * Runs only against a migrated Postgres (export DATABASE_URL locally; CI
 * provides one).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const SECRET = 'x'.repeat(32);
const approvedReview = () => ({
  identityVerified: true,
  addressVerified: true,
  sanctionsClear: true,
  pepReviewComplete: true,
  fundsVerified: true,
  taxDocumentationComplete: true,
  amlRiskRating: 'medium',
  seniorApproval: false,
  policyKey: 'JM',
  nextReviewAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
});

async function signCookie(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return encodeURIComponent(`${value}.${btoa(String.fromCharCode(...new Uint8Array(sig)))}`);
}

interface ClientRow {
  account_id: string;
  status: string;
  client_email: string;
  kyc_tier: string;
  identity_verified: boolean;
  is_pep: boolean;
  risk_band: string | null;
  holdings_count: number;
}

suite('a partner accepts a client', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `clients-${Date.now()}`;

  const configFor = () =>
    loadServerConfig({
      APP_ENV: 'development',
      DATABASE_URL: DATABASE_URL ?? '',
      SUPABASE_URL: 'https://example.supabase.co',
      BETTER_AUTH_URL: 'http://localhost:3001',
      APP_WEB_ORIGIN: 'http://localhost:3000',
      BETTER_AUTH_SECRET: SECRET,
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      OPENAI_API_KEY: 'sk-test',
      FIELD_ENCRYPTION_KEY: 'base64:key',
    });

  function app() {
    const config = configFor();
    return createApp({
      db,
      auth: createAuth(db, config),
      config,
      logger: createLogger({ level: 'error', sink: () => {} }),
    });
  }

  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};
  let sagId = '';
  let ncbId = '';

  async function makeUser(key: string, role?: { role: 'partner_operator'; partnerId: string }) {
    const [row] = await db
      .insert(user)
      .values({ name: key, email: `${tag}-${key}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    const id = row?.id ?? '';
    ids[key] = id;
    if (role) {
      await db
        .insert(userRoles)
        .values({ userId: id, role: role.role, partnerId: role.partnerId })
        .onConflictDoNothing();
    }
    const token = `${tag}-${key}-token`;
    await db
      .insert(session)
      .values({ userId: id, token, expiresAt: new Date(Date.now() + 3_600_000) });
    cookies[key] = `ccn.session_token=${await signCookie(token, SECRET)}`;
    return id;
  }

  beforeAll(async () => {
    // `sandbox` on both, because the adapter registry — rightly — refuses to
    // read through an agreement that is only a prospect.
    for (const p of [
      { code: 'SAG' as const, name: 'Sagicor Investments', agreementStatus: 'sandbox' as const },
      {
        code: 'NCB' as const,
        name: 'National Commercial Bank',
        agreementStatus: 'sandbox' as const,
      },
    ]) {
      await db
        .insert(partners)
        .values(p)
        .onConflictDoUpdate({ target: partners.code, set: { agreementStatus: 'sandbox' } });
    }
    const rows = await db
      .select({ id: partners.id, code: partners.code })
      .from(partners)
      .where(inArray(partners.code, ['SAG', 'NCB']));
    sagId = rows.find((p) => p.code === 'SAG')?.id ?? '';
    ncbId = rows.find((p) => p.code === 'NCB')?.id ?? '';
    expect(sagId && ncbId).toBeTruthy();

    await makeUser('sagOperator', { role: 'partner_operator', partnerId: sagId });
    await makeUser('ncbOperator', { role: 'partner_operator', partnerId: ncbId });

    // An investor who has finished onboarding: there is a package to pass on.
    const investorId = await makeUser('investor');
    await db.insert(kycStatus).values({
      userId: investorId,
      tier: 'tier2',
      identityVerified: true,
      complianceConfirmed: true,
      riskCompleted: true,
      fundsConfirmed: true,
      sources: ['salary'],
    });

    // And one who has not, which the firm must be told about rather than
    // silently handed an empty package for.
    await makeUser('unverified');
  });

  afterAll(async () => {
    const all = Object.values(ids);
    if (all.length > 0) {
      await db.delete(holdings).where(inArray(holdings.userId, all));
      await db.delete(connectedAccounts).where(inArray(connectedAccounts.userId, all));
      await db.delete(kycStatus).where(inArray(kycStatus.userId, all));
      await db.delete(session).where(inArray(session.userId, all));
      await db.delete(userRoles).where(inArray(userRoles.userId, all));
      await db.delete(user).where(inArray(user.id, all));
    }
    await handle.client.end({ timeout: 5 });
  });

  async function call(path: string, key: string, init?: RequestInit) {
    return app().request(path, {
      ...init,
      headers: {
        cookie: cookies[key] ?? '',
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  }

  async function clientsOf(key: string): Promise<ClientRow[]> {
    const res = await call('/api/console/clients', key);
    expect(res.status).toBe(200);
    return ((await res.json()) as { clients: ClientRow[] }).clients;
  }

  test('connecting an account asks the firm; it does not read from them', async () => {
    const res = await call('/api/portfolio/accounts', 'investor', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; holdings: number };
    expect(body.status).toBe('pending');
    expect(body.holdings).toBe(0);

    // Nothing was pulled — the firm has not agreed to anything yet.
    const owned = await db
      .select({ id: holdings.id })
      .from(holdings)
      .where(eq(holdings.userId, ids.investor ?? ''));
    expect(owned).toHaveLength(0);
  });

  test('pressing Connect again does not skip the queue', async () => {
    const res = await call('/api/portfolio/accounts', 'investor', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('pending');
    const owned = await db
      .select({ id: holdings.id })
      .from(holdings)
      .where(eq(holdings.userId, ids.investor ?? ''));
    expect(owned).toHaveLength(0);
  });

  test('the investor can see the request they are waiting on', async () => {
    // A pending link produces no holdings, so a screen built only from holdings
    // would show the investor nothing at all where they went looking for it.
    const res = await call('/api/portfolio', 'investor');
    const body = (await res.json()) as {
      partners: unknown[];
      connections: { code: string; name: string; status: string }[];
    };
    expect(body.partners).toHaveLength(0);
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]?.code).toBe('SAG');
    expect(body.connections[0]?.name).toBe('Sagicor Investments');
    expect(body.connections[0]?.status).toBe('pending');
  });

  test('the operator sees the client and the KYC package CCN passes across', async () => {
    const clients = await clientsOf('sagOperator');
    const mine = clients.find((c) => c.client_email === `${tag}-investor@x.com`);
    expect(mine).toBeDefined();
    expect(mine?.status).toBe('pending');
    expect(mine?.kyc_tier).toBe('tier2');
    expect(mine?.identity_verified).toBe(true);
    expect(mine?.is_pep).toBe(false);
    expect(mine?.holdings_count).toBe(0);
  });

  test("another firm's operator sees nothing of that client", async () => {
    const clients = await clientsOf('ncbOperator');
    expect(clients.find((c) => c.client_email === `${tag}-investor@x.com`)).toBeUndefined();
  });

  test('an investor cannot read the client list at all', async () => {
    const res = await call('/api/console/clients', 'investor');
    expect(res.status).toBe(403);
  });

  test('a retained future corridor cannot be used to approve onboarding yet', async () => {
    const [mine] = (await clientsOf('sagOperator')).filter(
      (c) => c.client_email === `${tag}-investor@x.com`,
    );
    const accept = await call(`/api/console/clients/${mine?.account_id}/accept`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify({ ...approvedReview(), policyKey: 'BB' }),
    });
    expect(accept.status).toBe(409);
    expect(((await accept.json()) as { error: string }).error).toContain('future use');
    expect(
      (await clientsOf('sagOperator')).find((c) => c.account_id === mine?.account_id)?.status,
    ).toBe('pending');
  });

  test('accepting is what makes the holdings pullable', async () => {
    const [mine] = (await clientsOf('sagOperator')).filter(
      (c) => c.client_email === `${tag}-investor@x.com`,
    );
    const accept = await call(`/api/console/clients/${mine?.account_id}/accept`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify(approvedReview()),
    });
    expect(accept.status).toBe(200);
    expect(((await accept.json()) as { status: string }).status).toBe('active');

    const res = await call('/api/portfolio/accounts', 'investor', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; holdings: number; refreshed: boolean };
    expect(body.status).toBe('active');
    expect(body.holdings).toBeGreaterThan(0);
    expect(body.refreshed).toBe(false);

    const owned = await db
      .select({ id: holdings.id })
      .from(holdings)
      .where(eq(holdings.userId, ids.investor ?? ''));
    expect(owned.length).toBe(body.holdings);
  });

  test('a second review of the same client is refused', async () => {
    const [mine] = (await clientsOf('sagOperator')).filter(
      (c) => c.client_email === `${tag}-investor@x.com`,
    );
    const res = await call(`/api/console/clients/${mine?.account_id}/accept`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify(approvedReview()),
    });
    expect(res.status).toBe(409);
  });

  test("an operator cannot act on another firm's client", async () => {
    const [mine] = (await clientsOf('sagOperator')).filter(
      (c) => c.client_email === `${tag}-investor@x.com`,
    );
    const res = await call(`/api/console/clients/${mine?.account_id}/decline`, 'ncbOperator', {
      method: 'POST',
      body: JSON.stringify({ reason: 'not mine to decline' }),
    });
    expect(res.status).toBe(409);
  });

  test('a client with no KYC cannot be accepted, and the firm is told why', async () => {
    await call('/api/portfolio/accounts', 'unverified', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG' }),
    });
    const [row] = (await clientsOf('sagOperator')).filter(
      (c) => c.client_email === `${tag}-unverified@x.com`,
    );
    expect(row?.kyc_tier).toBe('none');

    const res = await call(`/api/console/clients/${row?.account_id}/accept`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify(approvedReview()),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('not finished onboarding');
  });

  test('declining says so, and Connect does not work around it', async () => {
    const [row] = (await clientsOf('sagOperator')).filter(
      (c) => c.client_email === `${tag}-unverified@x.com`,
    );
    const declined = await call(`/api/console/clients/${row?.account_id}/decline`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify({ reason: 'onboarding incomplete' }),
    });
    expect(declined.status).toBe(200);
    expect(((await declined.json()) as { status: string }).status).toBe('declined');

    const retry = await call('/api/portfolio/accounts', 'unverified', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG' }),
    });
    expect(retry.status).toBe(409);

    const portfolio = (await (await call('/api/portfolio', 'unverified')).json()) as {
      connections: { status: string; declineReason: string | null }[];
    };
    expect(portfolio.connections[0]?.status).toBe('declined');
    expect(portfolio.connections[0]?.declineReason).toBe('onboarding incomplete');
  });

  test('the decision is on the audit trail with the package as it stood', async () => {
    const res = await call('/api/console/audit?limit=200', 'sagOperator');
    const { entries } = (await res.json()) as {
      entries: { action: string; detail: Record<string, unknown> }[];
    };
    const accepted = entries.find((e) => e.action === 'client.accepted');
    expect(accepted).toBeDefined();
    expect(accepted?.detail.kyc_tier).toBe('tier2');
    expect(accepted?.detail.identity_verified).toBe(true);
    const declined = entries.find((e) => e.action === 'client.declined');
    expect(declined?.detail.reason).toBe('onboarding incomplete');
  });
});
