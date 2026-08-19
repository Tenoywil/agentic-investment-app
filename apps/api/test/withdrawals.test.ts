import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import {
  connectedAccounts,
  createDb,
  holdings,
  partners,
  reconciliationItems,
  session,
  user,
  userRoles,
  withdrawalRequests,
} from '@ccn/db';
import { and, eq, inArray } from 'drizzle-orm';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { createLogger } from '../src/logger';

/**
 * Money out, proven at the HTTP boundary — and money in by declaration.
 *
 * The properties that matter, in the order the money moves:
 *
 *   1. "I've sent it" lands in the firm's reconciliation queue and credits
 *      NOTHING — the desk's Match is the only thing that creates cash.
 *   2. A withdrawal request freezes the firm's charges (fee + GCT on the fee)
 *      at request time, deducts nothing, and refuses to exist twice.
 *   3. The firm's decision is the only thing that moves the cash, the exact
 *      amount it moves is the requested amount, and declining requires words.
 *   4. Another firm's operator cannot decide it.
 *
 * Runs only against a migrated Postgres (export DATABASE_URL locally).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

const SECRET = 'x'.repeat(32);

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

suite('withdrawals and funding notices', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `wd-${Date.now()}`;

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
  let accountId = '';
  let cashHoldingId = '';
  /** SAG's charges as this suite sets them: US$5 flat + 1%, GCT 15% on the fee. */
  const FEE_FLAT = 500n;
  const FEE_BPS = 100;
  const GCT_BPS = 1500;

  async function makeUser(key: string, partnerId?: string) {
    const [row] = await db
      .insert(user)
      .values({ name: key, email: `${tag}-${key}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    const id = row?.id ?? '';
    ids[key] = id;
    await db
      .insert(userRoles)
      .values(
        partnerId
          ? { userId: id, role: 'partner_operator', partnerId }
          : { userId: id, role: 'customer' },
      )
      .onConflictDoNothing();
    const token = `${tag}-${key}-token`;
    await db
      .insert(session)
      .values({ userId: id, token, expiresAt: new Date(Date.now() + 3_600_000) });
    cookies[key] = `ccn.session_token=${await signCookie(token, SECRET)}`;
  }

  function request(path: string, who: string, init?: RequestInit) {
    return app().request(path, {
      ...init,
      headers: {
        cookie: cookies[who] ?? '',
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
    });
  }

  async function cashNow(): Promise<bigint> {
    const [row] = await db
      .select({ v: holdings.valueMinor })
      .from(holdings)
      .where(eq(holdings.id, cashHoldingId));
    return row?.v ?? -1n;
  }

  beforeAll(async () => {
    const partnerRows = await db
      .select({ id: partners.id, code: partners.code })
      .from(partners)
      .where(inArray(partners.code, ['SAG', 'NCB']));
    sagId = partnerRows.find((p) => p.code === 'SAG')?.id ?? '';
    ncbId = partnerRows.find((p) => p.code === 'NCB')?.id ?? '';
    expect(sagId && ncbId).toBeTruthy();

    // The charges the whole suite asserts against. Set directly: the settings
    // API is exercised by console-surface.test.ts; here they are fixture.
    await db
      .update(partners)
      .set({ withdrawalFeeFlatMinor: FEE_FLAT, withdrawalFeeBps: FEE_BPS, gctBps: GCT_BPS })
      .where(eq(partners.id, sagId));

    await makeUser('investor');
    await makeUser('sagOperator', sagId);
    await makeUser('ncbOperator', ncbId);

    const [account] = await db
      .insert(connectedAccounts)
      .values({ userId: ids.investor ?? '', partnerId: sagId, label: tag, status: 'active' })
      .returning({ id: connectedAccounts.id });
    accountId = account?.id ?? '';

    // US$10,000 of recorded, uninvested cash — a holding with no instrument.
    const [cash] = await db
      .insert(holdings)
      .values({
        userId: ids.investor ?? '',
        connectedAccountId: accountId,
        instrumentId: null,
        name: 'Cash · settled funds',
        valueMinor: 1_000_000n,
        currency: 'USD',
      })
      .returning({ id: holdings.id });
    cashHoldingId = cash?.id ?? '';
  });

  afterAll(async () => {
    const all = Object.values(ids);
    if (all.length > 0) {
      await db.delete(withdrawalRequests).where(inArray(withdrawalRequests.userId, all));
      await db.delete(reconciliationItems).where(inArray(reconciliationItems.userId, all));
      await db.delete(session).where(inArray(session.userId, all));
      await db.delete(userRoles).where(inArray(userRoles.userId, all));
      await db.delete(user).where(inArray(user.id, all)); // holdings/accounts cascade
    }
    // Put SAG's charges back to nothing so no other suite inherits them.
    await db
      .update(partners)
      .set({ withdrawalFeeFlatMinor: 0n, withdrawalFeeBps: 0, gctBps: 0 })
      .where(eq(partners.id, sagId));
    await handle.close();
  });

  test('a funding notice queues for the desk and credits nothing', async () => {
    const before = await cashNow();
    const receiptText = 'wire receipt fixture';
    const res = await request('/api/portfolio/funding-notice', 'investor', {
      method: 'POST',
      body: JSON.stringify({
        partnerCode: 'SAG',
        amountMinor: '250000',
        currency: 'USD',
        reference: 'TRD-88214',
        receipt: {
          name: 'wire-receipt.pdf',
          mime: 'application/pdf',
          data: btoa(receiptText),
        },
      }),
    });
    expect(res.status).toBe(201);

    // Nothing moved: the declaration is a claim, not a credit.
    expect(await cashNow()).toBe(before);

    const items = await db
      .select({
        id: reconciliationItems.id,
        source: reconciliationItems.source,
        status: reconciliationItems.status,
      })
      .from(reconciliationItems)
      .where(
        and(
          eq(reconciliationItems.userId, ids.investor ?? ''),
          eq(reconciliationItems.source, 'investor_notice'),
        ),
      );
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe('pending');

    // The desk sees the reference and receipt metadata, not the base64 payload
    // in its queue response. It fetches the bytes through a partner-scoped
    // attachment endpoint only when an operator opens the evidence.
    const queue = await request('/api/console/reconciliation', 'sagOperator');
    expect(queue.status).toBe(200);
    const queueBody = (await queue.json()) as {
      items: { id: string; raw: { reference?: string; receipt?: Record<string, unknown> } }[];
    };
    const notice = queueBody.items.find((item) => item.id === items[0]?.id);
    expect(notice?.raw.reference).toBe('TRD-88214');
    expect(notice?.raw.receipt?.name).toBe('wire-receipt.pdf');
    expect(notice?.raw.receipt?.data).toBeUndefined();

    const receipt = await request(
      `/api/console/reconciliation/${items[0]?.id}/receipt`,
      'sagOperator',
    );
    expect(receipt.status).toBe(200);
    expect(receipt.headers.get('content-disposition')).toContain('wire-receipt.pdf');
    expect(await receipt.text()).toBe(receiptText);

    const stranger = await request(
      `/api/console/reconciliation/${items[0]?.id}/receipt`,
      'ncbOperator',
    );
    expect(stranger.status).toBe(404);
  });

  test('a request freezes fee and GCT at request time and deducts nothing', async () => {
    const before = await cashNow();
    const res = await request('/api/portfolio/withdrawals', 'investor', {
      method: 'POST',
      // US$1,000 → fee = 500 flat + 1% (1000) = 1500; GCT = 15% of the fee = 225.
      body: JSON.stringify({ partnerCode: 'SAG', amountMinor: '100000', currency: 'USD' }),
    });
    expect(res.status).toBe(201);
    const { withdrawal } = (await res.json()) as {
      withdrawal: { fee_minor: string; gct_minor: string; status: string };
    };
    expect(withdrawal.status).toBe('pending');
    expect(String(withdrawal.fee_minor)).toBe('1500');
    expect(String(withdrawal.gct_minor)).toBe('225');

    // Asking moved nothing.
    expect(await cashNow()).toBe(before);

    // A rate change AFTER the request must not reprice it: the row keeps the
    // figures the client consented to.
    await db.update(partners).set({ withdrawalFeeBps: 500 }).where(eq(partners.id, sagId));
    const [row] = await db
      .select({ fee: withdrawalRequests.feeMinor })
      .from(withdrawalRequests)
      .where(eq(withdrawalRequests.userId, ids.investor ?? ''));
    expect(row?.fee).toBe(1500n);
    await db.update(partners).set({ withdrawalFeeBps: FEE_BPS }).where(eq(partners.id, sagId));
  });

  test('a second request while one is pending is refused', async () => {
    const res = await request('/api/portfolio/withdrawals', 'investor', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG', amountMinor: '5000', currency: 'USD' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('already pending');
  });

  test("another firm's operator cannot decide it; declining needs words", async () => {
    const [pending] = await db
      .select({ id: withdrawalRequests.id })
      .from(withdrawalRequests)
      .where(
        and(
          eq(withdrawalRequests.userId, ids.investor ?? ''),
          eq(withdrawalRequests.status, 'pending'),
        ),
      );
    const id = pending?.id ?? '';
    expect(id).toBeTruthy();

    // NCB's operator: the request is SAG's, so for them it is not pending.
    const foreign = await request(`/api/console/withdrawals/${id}/decide`, 'ncbOperator', {
      method: 'POST',
      body: JSON.stringify({ paid: false, reason: 'not ours' }),
    });
    expect(foreign.status).toBe(409);

    // Declining with no reason never leaves the schema.
    const wordless = await request(`/api/console/withdrawals/${id}/decide`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify({ paid: false }),
    });
    expect(wordless.status).toBe(400);

    const declined = await request(`/api/console/withdrawals/${id}/decide`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify({ paid: false, reason: 'Call us to verify your payout account first.' }),
    });
    expect(declined.status).toBe(200);

    // Declining moved nothing, and the investor reads the reason verbatim.
    expect(await cashNow()).toBe(1_000_000n);
    const portfolio = await request('/api/portfolio', 'investor');
    const { withdrawals } = (await portfolio.json()) as {
      withdrawals: { status: string; reason: string | null }[];
    };
    expect(withdrawals[0]?.status).toBe('declined');
    expect(withdrawals[0]?.reason).toContain('verify your payout account');
  });

  test('paying moves exactly the requested amount, once', async () => {
    const res = await request('/api/portfolio/withdrawals', 'investor', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG', amountMinor: '200000', currency: 'USD' }),
    });
    expect(res.status).toBe(201);
    const { withdrawal } = (await res.json()) as { withdrawal: { id: string } };

    const paid = await request(`/api/console/withdrawals/${withdrawal.id}/decide`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify({ paid: true, reference: `WIRE-${tag}` }),
    });
    expect(paid.status).toBe(200);

    // The full requested amount left the recorded cash — the firm keeps the
    // fee and GCT out of it and pays the client the net.
    expect(await cashNow()).toBe(800_000n);

    // Deciding a decided request is refused, so it cannot pay twice.
    const again = await request(`/api/console/withdrawals/${withdrawal.id}/decide`, 'sagOperator', {
      method: 'POST',
      body: JSON.stringify({ paid: true }),
    });
    expect(again.status).toBe(409);
    expect(await cashNow()).toBe(800_000n);

    // The console queue shows the desk the net it actually pays.
    const queue = await request('/api/console/withdrawals', 'sagOperator');
    const { withdrawals } = (await queue.json()) as {
      withdrawals: { id: string; netMinor: string; reference: string | null }[];
    };
    const row = withdrawals.find((w) => w.id === withdrawal.id);
    // 200000 − (500 + 2000) fee − 375 GCT = 197125.
    expect(row?.netMinor).toBe('197125');
    expect(row?.reference).toBe(`WIRE-${tag}`);

    // The decision is SIGNED: the audit trail names the operator who paid it,
    // not an anonymous "Operator" — who accepted what is the record's job.
    const audit = await request('/api/console/audit?limit=20', 'sagOperator');
    const { entries } = (await audit.json()) as {
      entries: { action: string; actorName: string | null }[];
    };
    const paidEntry = entries.find((e) => e.action === 'withdrawal.paid');
    expect(paidEntry?.actorName).toBe('sagOperator');
  });

  test('a request the recorded cash cannot cover is refused', async () => {
    const res = await request('/api/portfolio/withdrawals', 'investor', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG', amountMinor: '99000000', currency: 'USD' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('does not cover');
  });

  test('a request the charges would consume is refused at the door', async () => {
    // US$5 requested against a US$5 flat fee: nothing would reach the client.
    const res = await request('/api/portfolio/withdrawals', 'investor', {
      method: 'POST',
      body: JSON.stringify({ partnerCode: 'SAG', amountMinor: '500', currency: 'USD' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('charges');
  });
});
