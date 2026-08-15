import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import {
  connectedAccounts,
  createDb,
  holdings,
  instruments,
  kycStatus,
  orders,
  partners,
  reconciliationItems,
  session,
  user,
  userRoles,
} from '@ccn/db';
import { eq, inArray, sql } from 'drizzle-orm';
import { createApp } from '../src/app';
import { createAuth } from '../src/auth';
import { createLogger } from '../src/logger';

/**
 * The partner console's data surface, proven at the HTTP boundary.
 *
 * Everything the console renders about *whose* firm it is used to be a string
 * literal in the page component — "Sagicor Group", "FSC Jamaica", five invented
 * audit entries — so every operator on the network saw one particular firm's
 * name above their own order flow. These four routes are what replaced that,
 * and the property that matters for each is the same one: an operator sees
 * their own partner and nobody else's.
 *
 * `/orders` gets its own case because the join is the whole point — without it
 * the console can only name an order by a sliced UUID.
 *
 * Runs only against a migrated Postgres (export DATABASE_URL locally; CI
 * provides one).
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

suite('partner console data surface', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `console-${Date.now()}`;

  // Built lazily: `describe.skip` still evaluates this callback, so an eager
  // loadServerConfig would throw on the empty DATABASE_URL in the no-DB CI job.
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
  let instrumentId = '';
  let listingId = '';
  /** SAG's client connection, for the drill-down and the revoke path. */
  let clientAccountId = '';
  /** Everything the listing tests create, so afterAll can take it back out. */
  const createdInstrumentIds: string[] = [];

  /**
   * A signed-in user. `partnerId` makes them a partner_operator for that firm;
   * without one they are a customer, which is the only role /api/opportunities
   * and /api/orders will serve — those are guarded by requireCustomer, so an
   * operator cannot stand in for an investor when checking that a listing
   * actually reached the marketplace.
   */
  async function makeOperator(key: string, partnerId?: string) {
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

  beforeAll(async () => {
    /**
     * Two partners: the caller's, and the one whose data must never leak.
     *
     * Upserting the NAME, not inserting-and-ignoring. The firm-profile test
     * renames SAG for real — that is the feature — and with
     * onConflictDoNothing that rename survived into the next run, where the
     * marketplace test asserts the listing carries "Sagicor Investments". A
     * fixture that is only correct on a fresh database is a test that passes
     * once.
     */
    for (const p of [
      { code: 'SAG' as const, name: 'Sagicor Investments' },
      { code: 'NCB' as const, name: 'National Commercial Bank' },
    ]) {
      await db
        .insert(partners)
        .values(p)
        .onConflictDoUpdate({ target: partners.code, set: { name: p.name } });
    }
    const partnerRows = await db
      .select({ id: partners.id, code: partners.code })
      .from(partners)
      .where(inArray(partners.code, ['SAG', 'NCB']));
    sagId = partnerRows.find((p) => p.code === 'SAG')?.id ?? '';
    ncbId = partnerRows.find((p) => p.code === 'NCB')?.id ?? '';
    expect(sagId && ncbId).toBeTruthy();

    await makeOperator('sagOperator', sagId);
    await makeOperator('ncbOperator', ncbId);
    await makeOperator('investor');

    const [inst] = await db
      .insert(instruments)
      .values({
        slug: `${tag}-goj`,
        abbr: 'GOJ32',
        type: 'bond',
        partnerId: sagId,
        name: 'GOJ USD Global Bond 2032',
      })
      .returning({ id: instruments.id });
    instrumentId = inst?.id ?? '';

    // Orders are normally written only through create_order(); the fixture
    // inserts directly on the privileged test connection so the join, not the
    // creation choke point, is what this file is testing.
    await db.insert(orders).values([
      {
        userId: ids.sagOperator ?? '',
        partnerId: sagId,
        instrumentId,
        amountMinor: 500_000n,
        currency: 'USD',
        idempotencyKey: `${tag}-with-instrument`,
        clientRef: 'Client ••7134',
      },
      {
        userId: ids.sagOperator ?? '',
        partnerId: sagId,
        instrumentId: null,
        amountMinor: 200_000n,
        currency: 'USD',
        idempotencyKey: `${tag}-no-instrument`,
      },
    ]);

    // The listing the toggle test flips. It is an `instruments` row now: the
    // console moved onto the table the marketplace reads, because a
    // `product_listings` row was one no investor could ever be shown.
    const [listing] = await db
      .insert(instruments)
      .values({
        slug: `${tag}-listing`,
        abbr: 'LIST',
        type: 'fund',
        partnerId: sagId,
        name: `${tag} listing`,
      })
      .returning({ id: instruments.id });
    listingId = listing?.id ?? '';

    /**
     * A client of SAG's, with a position, so the drill-down has something to
     * drill into. The KYC row matters: `partner_review_client` refuses to grant
     * access to somebody with no package to review, which is the floor
     * reinstating has to clear too.
     */
    await db
      .insert(kycStatus)
      .values({ userId: ids.investor ?? '', tier: 'tier1', identityVerified: true })
      .onConflictDoNothing();
    const [account] = await db
      .insert(connectedAccounts)
      .values({
        userId: ids.investor ?? '',
        partnerId: sagId,
        label: `${tag} account`,
        status: 'active',
      })
      .returning({ id: connectedAccounts.id });
    clientAccountId = account?.id ?? '';
    await db.insert(holdings).values({
      userId: ids.investor ?? '',
      connectedAccountId: clientAccountId,
      instrumentId,
      name: 'GOJ USD Global Bond 2032',
      valueMinor: 1_250_000n,
      currency: 'USD',
      returnLabel: '+6.8%',
    });

    // One audit row per partner, through the append-only hash-chained function.
    for (const [partnerId, action] of [
      [sagId, `${tag}.sag`],
      [ncbId, `${tag}.ncb`],
    ] as const) {
      await db.execute(
        sql`select audit_append('system'::actor_type, NULL::uuid, NULL::uuid, ${partnerId}::uuid,
          ${action}::text, 'test'::text, NULL::uuid, '{}'::jsonb)`,
      );
    }
  });

  afterAll(async () => {
    const all = Object.values(ids);
    if (all.length > 0) {
      await db.delete(session).where(inArray(session.userId, all));
      await db.delete(userRoles).where(inArray(userRoles.userId, all));
      // orders cascade with their owning user.
      await db.delete(user).where(inArray(user.id, all));
    }
    // Products this suite listed through the console, plus the two fixtures.
    await db.delete(instruments).where(inArray(instruments.id, createdInstrumentIds));
    if (listingId) await db.delete(instruments).where(eq(instruments.id, listingId));
    if (instrumentId) await db.delete(instruments).where(eq(instruments.id, instrumentId));
    // Put the names back, so a file that runs after this one sees the seeded
    // firms rather than whatever this suite renamed them to.
    for (const p of [
      { code: 'SAG', name: 'Sagicor Investments' },
      { code: 'NCB', name: 'National Commercial Bank' },
    ]) {
      await db.update(partners).set({ name: p.name }).where(eq(partners.code, p.code));
    }
    // audit_log is append-only by design (BEFORE UPDATE OR DELETE raises for
    // everyone, superusers included), so the two rows above stay. They are
    // namespaced by `tag`, so they cannot collide with a later run.
    await handle.client.end({ timeout: 5 });
  });

  async function json<T>(path: string, key: string, init?: RequestInit): Promise<T> {
    const res = await app().request(path, {
      ...init,
      headers: { cookie: cookies[key] ?? '', ...(init?.headers ?? {}) },
    });
    expect(res.status).toBe(200);
    return (await res.json()) as T;
  }

  test('/console/partner returns the caller’s own partner, never another’s', async () => {
    type Body = { partner: { id: string; code: string; name: string } };
    const sag = await json<Body>('/api/console/partner', 'sagOperator');
    expect(sag.partner.id).toBe(sagId);
    expect(sag.partner.code).toBe('SAG');
    expect(sag.partner.id).not.toBe(ncbId);

    const ncb = await json<Body>('/api/console/partner', 'ncbOperator');
    expect(ncb.partner.id).toBe(ncbId);
    expect(ncb.partner.code).toBe('NCB');
    expect(ncb.partner.name).not.toBe(sag.partner.name);
  });

  test('/console/orders carries instrument names', async () => {
    type Body = {
      orders: {
        idempotencyKey: string;
        instrumentName: string | null;
        instrumentAbbr: string | null;
        amountMinor: string;
      }[];
    };
    const { orders: rows } = await json<Body>('/api/console/orders', 'sagOperator');

    const joined = rows.find((o) => o.idempotencyKey === `${tag}-with-instrument`);
    expect(joined?.instrumentName).toBe('GOJ USD Global Bond 2032');
    expect(joined?.instrumentAbbr).toBe('GOJ32');
    // Money still crosses the wire as a numeric string, not a lossy number.
    expect(joined?.amountMinor).toBe('500000');

    // The join is LEFT: an instrument-less order still appears, with nulls the
    // client can branch on rather than a missing row.
    const orphan = rows.find((o) => o.idempotencyKey === `${tag}-no-instrument`);
    expect(orphan).toBeDefined();
    expect(orphan?.instrumentName).toBeNull();

    // The other partner's operator sees none of it.
    const other = await json<Body>('/api/console/orders', 'ncbOperator');
    expect(other.orders.some((o) => o.idempotencyKey.startsWith(tag))).toBe(false);
  });

  test('/console/orders filters, searches and pages, and reports the real total', async () => {
    type Body = {
      orders: { idempotencyKey: string; status: string; instrumentName: string | null }[];
      total: number;
    };

    // Unfiltered: the page plus a total the client cannot otherwise know once
    // the rows are truncated.
    const all = await json<Body>('/api/console/orders', 'sagOperator');
    expect(all.total).toBeGreaterThanOrEqual(all.orders.length);
    expect(all.total).toBeGreaterThan(0);

    // A status the fixtures have, and one they do not: the filter has to be
    // capable of returning nothing, or it is not filtering.
    const created = await json<Body>('/api/console/orders?status=created', 'sagOperator');
    expect(created.orders.every((o) => o.status === 'created')).toBe(true);
    const expired = await json<Body>('/api/console/orders?status=expired', 'sagOperator');
    expect(expired.orders).toEqual([]);
    expect(expired.total).toBe(0);

    // An unknown status is ignored rather than 500ing or matching nothing —
    // the enum is the allowlist.
    const bogus = await json<Body>('/api/console/orders?status=nonsense', 'sagOperator');
    expect(bogus.total).toBe(all.total);

    // Search hits the instrument name.
    const hit = await json<Body>('/api/console/orders?q=GOJ', 'sagOperator');
    expect(hit.orders.some((o) => o.idempotencyKey === `${tag}-with-instrument`)).toBe(true);
    const miss = await json<Body>('/api/console/orders?q=zzzznotathing', 'sagOperator');
    expect(miss.orders).toEqual([]);

    // Paging: one row at a time walks the same list without repeating itself,
    // and `total` stays the size of the whole result, not of the page.
    const first = await json<Body>('/api/console/orders?limit=1&offset=0', 'sagOperator');
    const second = await json<Body>('/api/console/orders?limit=1&offset=1', 'sagOperator');
    expect(first.orders).toHaveLength(1);
    expect(second.orders).toHaveLength(1);
    expect(first.orders[0]?.idempotencyKey).not.toBe(second.orders[0]?.idempotencyKey);
    expect(first.total).toBe(all.total);

    // And a page is still this partner's book only.
    const other = await json<Body>('/api/console/orders?limit=200', 'ncbOperator');
    expect(other.orders.some((o) => o.idempotencyKey.startsWith(tag))).toBe(false);
  });

  test('/console/audit returns only this partner’s rows', async () => {
    type Body = { entries: { action: string; seq: string; actorType: string }[] };
    const { entries } = await json<Body>('/api/console/audit?limit=50', 'sagOperator');
    const actions = entries.map((e) => e.action);
    expect(actions).toContain(`${tag}.sag`);
    expect(actions).not.toContain(`${tag}.ncb`);

    const { entries: theirs } = await json<Body>('/api/console/audit?limit=50', 'ncbOperator');
    const theirActions = theirs.map((e) => e.action);
    expect(theirActions).toContain(`${tag}.ncb`);
    expect(theirActions).not.toContain(`${tag}.sag`);

    // seq is a bigserial: a numeric string, and strictly descending.
    const seqs = entries.map((e) => BigInt(e.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => (a > b ? -1 : 1)));
  });

  test('/console/audit clamps limit', async () => {
    type Body = { entries: unknown[] };
    const one = await json<Body>('/api/console/audit?limit=1', 'sagOperator');
    expect(one.entries.length).toBeLessThanOrEqual(1);
    // Junk falls back to the default rather than 500ing or returning the lot.
    const junk = await json<Body>('/api/console/audit?limit=banana', 'sagOperator');
    expect(junk.entries.length).toBeLessThanOrEqual(50);
  });

  test('/console/products/:id/live toggles, and only for the owning partner', async () => {
    const paused = await json<{ status: string }>(
      `/api/console/products/${listingId}/live`,
      'sagOperator',
      { method: 'POST' },
    );
    expect(paused.status).toBe('paused');
    const live = await json<{ status: string }>(
      `/api/console/products/${listingId}/live`,
      'sagOperator',
      { method: 'POST' },
    );
    expect(live.status).toBe('live');

    // Another partner's operator cannot flip it, and learns nothing about it.
    const res = await app().request(`/api/console/products/${listingId}/live`, {
      method: 'POST',
      headers: { cookie: cookies.ncbOperator ?? '' },
    });
    expect(res.status).toBe(404);
    const [row] = await db
      .select({ status: instruments.listingStatus })
      .from(instruments)
      .where(eq(instruments.id, listingId));
    expect(row?.status).toBe('live');
  });

  /**
   * The point of the switch. Pausing used to flip a `product_listings` row that
   * nothing else in the product read, so the marketplace went on offering the
   * product and orders went on being accepted for it.
   */
  test('pausing a listing takes it out of the marketplace and refuses new orders', async () => {
    const opportunityIds = async (who = 'investor') => {
      const { opportunities } = await json<{ opportunities: { id: string }[] }>(
        '/api/opportunities',
        who,
      );
      return opportunities.map((o) => o.id);
    };

    expect(await opportunityIds()).toContain(listingId);

    const paused = await json<{ status: string }>(
      `/api/console/products/${listingId}/live`,
      'sagOperator',
      { method: 'POST' },
    );
    expect(paused.status).toBe('paused');

    expect(await opportunityIds()).not.toContain(listingId);

    // And a client holding the page open, who still has the id, is refused
    // rather than routed into a product the firm has withdrawn.
    const order = await app().request('/api/orders', {
      method: 'POST',
      headers: { cookie: cookies.investor ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ instrumentId: listingId, amountMinor: 10_000, currency: 'USD' }),
    });
    expect(order.status).toBe(409);
    expect(((await order.json()) as { error: string }).error).toContain('no longer offered');

    // Back on the shelf, and visible again.
    await json(`/api/console/products/${listingId}/live`, 'sagOperator', { method: 'POST' });
    expect(await opportunityIds()).toContain(listingId);
  });

  /**
   * Listing a product, and having an investor be able to see it.
   *
   * The old version of this test passed while the feature did not work: it
   * wrote a `product_listings` row, asserted the row came back, and never
   * asked the question that matters — whether the thing now exists in the
   * marketplace. It did not, and could not, because nothing joined the two
   * tables. So the assertions here follow the product through to
   * /api/opportunities, which is where a customer meets it.
   *
   * The property worth pinning on the way is that `partner_id` comes from the
   * caller's scope and never from the body: an operator lists for their own
   * firm or not at all, whatever they send.
   */
  const list = (body: unknown, who = 'sagOperator') =>
    app().request('/api/console/products', {
      method: 'POST',
      headers: { cookie: cookies[who] ?? '', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  test('a listed product reaches the marketplace, priced as the firm listed it', async () => {
    // 201, so this cannot go through the 200-asserting `json` helper.
    const res = await list({
      name: `${tag} Income Fund`,
      type: 'fund',
      currency: 'JMD',
      minInvestmentMinor: '250000',
      metric: '8.25%',
      metricLabel: 'Target return',
      term: '5 years',
      risk: 'medium',
      region: 'Jamaica',
      description: 'A fund listed by the console test.',
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      product: {
        id: string;
        status: string;
        currency: string;
        minInvestmentMinor: string;
        metric: string;
        metricLabel: string;
        risk: string;
      };
    };
    createdInstrumentIds.push(created.product.id);
    expect(created.product.status).toBe('live');

    // The fields a deal card renders survive the round trip. Before this, a
    // listing carried a name and a type, so every card showed "US$0", a blank
    // metric and "Not rated".
    expect(created.product.currency).toBe('JMD');
    expect(created.product.minInvestmentMinor).toBe('250000');
    expect(created.product.metric).toBe('8.25%');
    expect(created.product.metricLabel).toBe('Target return');
    expect(created.product.risk).toBe('medium');

    // It is in this partner's catalogue, and not in the other partner's.
    const mine = await json<{ products: { id: string }[] }>('/api/console/products', 'sagOperator');
    expect(mine.products.some((p) => p.id === created.product.id)).toBe(true);
    const theirs = await json<{ products: { id: string }[] }>(
      '/api/console/products',
      'ncbOperator',
    );
    expect(theirs.products.some((p) => p.id === created.product.id)).toBe(false);

    // The assertion the old test was missing: a customer can see it, under the
    // listing firm's name and regulator, priced as listed.
    const { opportunities } = await json<{
      opportunities: {
        id: string;
        partner: string | null;
        regulator: string | null;
        minInvestmentMinor: string;
        currency: string;
        risk: string | null;
      }[];
    }>('/api/opportunities', 'investor');
    const offered = opportunities.find((o) => o.id === created.product.id);
    expect(offered).toBeTruthy();
    expect(offered?.partner).toBe('Sagicor Investments');
    expect(offered?.minInvestmentMinor).toBe('250000');
    expect(offered?.currency).toBe('JMD');
    expect(offered?.risk).toBe('Medium');

    // The regulator is the firm's own, not one the console typed.
    const [partnerRow] = await db
      .select({ regulator: partners.regulator })
      .from(partners)
      .where(eq(partners.id, sagId));
    expect(offered?.regulator).toBe(partnerRow?.regulator ?? null);

    // partner_id comes from the caller's scope: a forged one is ignored.
    const forgedRes = await list({
      name: `${tag} Forged`,
      type: 'bond',
      partnerId: '00000000-0000-0000-0000-000000000000',
    });
    expect(forgedRes.status).toBe(201);
    const forged = (await forgedRes.json()) as { product: { id: string } };
    createdInstrumentIds.push(forged.product.id);
    const [forgedRow] = await db
      .select({ partnerId: instruments.partnerId })
      .from(instruments)
      .where(eq(instruments.id, forged.product.id));
    expect(forgedRow?.partnerId).toBe(sagId);
  });

  /** Amending is the same function, and must not touch anyone else's row. */
  test('an operator amends their own listing and nobody else’s', async () => {
    const res = await list({ name: `${tag} Amendable`, type: 'bond', minInvestmentMinor: '100' });
    const { product } = (await res.json()) as { product: { id: string } };
    createdInstrumentIds.push(product.id);

    const amended = await list({
      id: product.id,
      name: `${tag} Amended`,
      type: 'bond',
      minInvestmentMinor: '900',
      metric: '6%',
    });
    expect(amended.status).toBe(200);
    const after = (await amended.json()) as {
      product: { name: string; minInvestmentMinor: string; metric: string };
    };
    expect(after.product.name).toBe(`${tag} Amended`);
    expect(after.product.minInvestmentMinor).toBe('900');

    // The slug is not re-derived from the new name: holdings and reconciliation
    // join on it, so renaming a product must not orphan what people hold.
    const [row] = await db
      .select({ slug: instruments.slug })
      .from(instruments)
      .where(eq(instruments.id, product.id));
    expect(row?.slug).toContain('amendable');

    // Another firm's operator cannot amend it, and cannot tell it exists.
    const foreign = await list({ id: product.id, name: 'Hijacked', type: 'bond' }, 'ncbOperator');
    expect(foreign.status).toBe(404);
    const [unchanged] = await db
      .select({ name: instruments.name })
      .from(instruments)
      .where(eq(instruments.id, product.id));
    expect(unchanged?.name).toBe(`${tag} Amended`);
  });

  /**
   * The drill-down. The list row could say "1 position · US$12,500" and could
   * not say what it was, which is the first thing anyone asks about a client.
   */
  test('an operator opens one of their clients and sees where the money is', async () => {
    type Detail = {
      client: { account_id: string; client_name: string; status: string };
      holdings: { name: string; instrument_name: string | null; value_minor: string }[];
      orders: unknown[];
      audit: { action: string }[];
    };
    const detail = await json<Detail>(`/api/console/clients/${clientAccountId}`, 'sagOperator');
    expect(detail.client.account_id).toBe(clientAccountId);
    expect(detail.holdings).toHaveLength(1);
    expect(detail.holdings[0]?.value_minor).toBe('1250000');
    // The product's name, not a UUID: `holdings.name` is what the statement
    // called it, `instrument_name` is what it maps to in the catalogue.
    expect(detail.holdings[0]?.instrument_name).toBe('GOJ USD Global Bond 2032');

    // Another firm's operator gets the same answer as for an id that does not
    // exist, so client ids cannot be probed from a console.
    const foreign = await app().request(`/api/console/clients/${clientAccountId}`, {
      headers: { cookie: cookies.ncbOperator ?? '' },
    });
    expect(foreign.status).toBe(404);
    const missing = await app().request(
      '/api/console/clients/00000000-0000-0000-0000-000000000000',
      { headers: { cookie: cookies.sagOperator ?? '' } },
    );
    expect(missing.status).toBe(404);
  });

  /**
   * Revoking. `partner_review_client` hard-coded `status = 'pending'`, so
   * accepting a client was a one-way door: a firm needing to end a
   * relationship had no control anywhere in the console, and the audit row it
   * would have written is the one a regulator asks for.
   */
  test('an operator revokes an active client, and can reinstate them', async () => {
    const move = (accept: boolean, who = 'sagOperator', body: unknown = {}) =>
      app().request(`/api/console/clients/${clientAccountId}/${accept ? 'accept' : 'decline'}`, {
        method: 'POST',
        headers: { cookie: cookies[who] ?? '', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const revoked = await move(false, 'sagOperator', { reason: 'periodic review failed' });
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { status: string }).status).toBe('declined');

    const [row] = await db
      .select({ status: connectedAccounts.status, reason: connectedAccounts.declineReason })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, clientAccountId));
    expect(row?.status).toBe('declined');
    expect(row?.reason).toBe('periodic review failed');

    // Revoking is audited as its own event, not as a decline — the two are
    // different decisions and a regulator reading the log has to see which.
    const detail = await json<{ audit: { action: string }[] }>(
      `/api/console/clients/${clientAccountId}`,
      'sagOperator',
    );
    expect(detail.audit.map((a) => a.action)).toContain('client.revoked');

    // Revoking twice is refused rather than silently written again.
    expect((await move(false)).status).toBe(409);

    const back = await move(true);
    expect(back.status).toBe(200);
    expect(((await back.json()) as { status: string }).status).toBe('active');
    const after = await json<{ audit: { action: string }[] }>(
      `/api/console/clients/${clientAccountId}`,
      'sagOperator',
    );
    expect(after.audit.map((a) => a.action)).toContain('client.reinstated');

    // And none of it is another firm's to do.
    expect((await move(false, 'ncbOperator')).status).toBe(409);
    const [unchanged] = await db
      .select({ status: connectedAccounts.status })
      .from(connectedAccounts)
      .where(eq(connectedAccounts.id, clientAccountId));
    expect(unchanged?.status).toBe('active');
  });

  /**
   * The firm's own record.
   *
   * `partners` had an UPDATE grant and exactly one UPDATE policy — admin-only —
   * so a firm could not fix a typo in the name that appears beside every
   * product it lists. What matters as much as the fix is what it does not
   * reach: the regulator is a compliance claim rendered to investors, the code
   * resolves the executing adapter, and the agreement status gates live
   * routing.
   */
  test('a firm edits its own name, and cannot touch what CCN asserts about it', async () => {
    const before = await json<{ partner: { regulator: string | null; code: string } }>(
      '/api/console/partner',
      'sagOperator',
    );

    const res = await app().request('/api/console/partner', {
      method: 'PATCH',
      headers: { cookie: cookies.sagOperator ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({
        name: `${tag} Renamed Investments`,
        kind: 'Funds · Insurance',
        residency: 'Jamaica',
        // Sent and expected to be ignored — the function takes no parameter for
        // any of them, so there is nothing for a client to reach.
        code: 'HACK',
        regulator: 'FSC_BARBADOS',
        agreementStatus: 'live',
      }),
    });
    expect(res.status).toBe(200);

    const [row] = await db
      .select({
        name: partners.name,
        kind: partners.kind,
        residency: partners.residency,
        code: partners.code,
        regulator: partners.regulator,
        agreementStatus: partners.agreementStatus,
      })
      .from(partners)
      .where(eq(partners.id, sagId));
    expect(row?.name).toBe(`${tag} Renamed Investments`);
    expect(row?.kind).toBe('Funds · Insurance');
    expect(row?.residency).toBe('Jamaica');
    expect(row?.code).toBe('SAG');
    expect(row?.regulator).toBe(before.partner.regulator as never);
    expect(row?.agreementStatus).not.toBe('live');

    // Both sides of the change are on the audit row: a firm's name is what
    // investors see beside its products, so "from what, to what" is the
    // question worth being able to answer.
    const { entries } = await json<{ entries: { action: string; detail: unknown }[] }>(
      '/api/console/audit?limit=50',
      'sagOperator',
    );
    const entry = entries.find((e) => e.action === 'partner.profile_updated');
    expect(entry).toBeTruthy();
    const detail = entry?.detail as { from: { name: string }; to: { name: string } };
    expect(detail.to.name).toBe(`${tag} Renamed Investments`);
    expect(detail.from.name).not.toBe(detail.to.name);

    // A nameless firm is refused, and another firm's operator changes nothing
    // here — the partner comes from their own scope, so this edits NCB's row.
    const blank = await app().request('/api/console/partner', {
      method: 'PATCH',
      headers: { cookie: cookies.sagOperator ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' ' }),
    });
    expect(blank.status).toBe(400);

    await app().request('/api/console/partner', {
      method: 'PATCH',
      headers: { cookie: cookies.ncbOperator ?? '', 'content-type': 'application/json' },
      body: JSON.stringify({ name: `${tag} NCB Renamed` }),
    });
    const [sag] = await db
      .select({ name: partners.name })
      .from(partners)
      .where(eq(partners.id, sagId));
    expect(sag?.name).toBe(`${tag} Renamed Investments`);
  });

  /**
   * Two products with the same name.
   *
   * `0017` derived the slug from the name and the firm's code, and
   * `instruments.slug` is NOT NULL UNIQUE — so the second listing under a name
   * raised 23505 and the console answered an unexplained 500. Worse, an
   * operator who has just seen a failure retries, so one success made every
   * later attempt fail. It reached production.
   */
  test('a firm can list two products with the same name', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await list({ name: `${tag} Same Name Fund`, type: 'fund' });
      expect(res.status).toBe(201);
      const { product } = (await res.json()) as { product: { id: string } };
      ids.push(product.id);
      createdInstrumentIds.push(product.id);
    }
    expect(new Set(ids).size).toBe(3);

    // The name is what the operator typed; only the internal key is suffixed,
    // and it stays readable rather than becoming a UUID.
    const rows = await db
      .select({ slug: instruments.slug, name: instruments.name })
      .from(instruments)
      .where(inArray(instruments.id, ids));
    expect(new Set(rows.map((r) => r.slug)).size).toBe(3);
    for (const row of rows) {
      expect(row.name).toBe(`${tag} Same Name Fund`);
      expect(row.slug).toContain('same-name-fund');
    }
  });

  test('a name of nothing but punctuation still produces a usable slug', async () => {
    // `regexp_replace` + trim would leave an empty string, and slug is NOT NULL.
    const res = await list({ name: '###', type: 'fund' });
    // Refused by the schema's min(2)? No — '###' is three characters, so this
    // reaches the function and must not violate NOT NULL.
    expect(res.status).toBe(201);
    const { product } = (await res.json()) as { product: { id: string } };
    createdInstrumentIds.push(product.id);
    const [row] = await db
      .select({ slug: instruments.slug })
      .from(instruments)
      .where(eq(instruments.id, product.id));
    expect(row?.slug).toBeTruthy();
    expect(row?.slug.length).toBeGreaterThan(0);
  });

  /**
   * The desk fills its own reconciliation queue.
   *
   * The queue is the console's — Match and Reject live there — but only an
   * investor could fill it, one account at a time, from their own portfolio.
   * The pull walks the firm's ACTIVE clients only, and a firm whose agreement
   * is not routable is told so in a sentence rather than the unexplained 500
   * the adapter registry's (correct) refusal used to surface as.
   *
   * Hermetic on purpose: it uses partners of its own rather than SAG and NCB.
   * The first version pulled for SAG and filled the shared queue with items
   * the ingestion suite then matched instead of its own — a test that passed
   * alone and broke two others is a fixture leak, not coverage.
   */
  test('a desk pulls statements for its active clients, and a non-routable firm is told why', async () => {
    const suffix = String(Date.now() % 100000);
    const [routable] = await db
      .insert(partners)
      .values({ code: `PL${suffix}`, name: `${tag} Pullable`, agreementStatus: 'sandbox' })
      .returning({ id: partners.id });
    const [prospect] = await db
      .insert(partners)
      .values({ code: `PR${suffix}`, name: `${tag} Prospect`, agreementStatus: 'prospect' })
      .returning({ id: partners.id });
    const routableId = routable?.id ?? '';
    const prospectId = prospect?.id ?? '';

    await makeOperator('pullOperator', routableId);
    await makeOperator('prospectOperator', prospectId);
    // One active client of the routable firm, so the pull has a book to walk.
    const [acct] = await db
      .insert(connectedAccounts)
      .values({
        userId: ids.investor ?? '',
        partnerId: routableId,
        label: `${tag} pull account`,
        status: 'active',
      })
      .returning({ id: connectedAccounts.id });

    try {
      const res = await app().request('/api/console/reconciliation/pull', {
        method: 'POST',
        headers: { cookie: cookies.pullOperator ?? '' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { clients: number; queued: number };
      expect(body.clients).toBe(1);

      // A firm CCN is still talking to has no relationship to read through.
      const refused = await app().request('/api/console/reconciliation/pull', {
        method: 'POST',
        headers: { cookie: cookies.prospectOperator ?? '' },
      });
      expect(refused.status).toBe(409);
      expect(((await refused.json()) as { error: string }).error).toContain('prospect');

      // A customer is not a desk.
      const customer = await app().request('/api/console/reconciliation/pull', {
        method: 'POST',
        headers: { cookie: cookies.investor ?? '' },
      });
      expect(customer.status).toBe(403);
    } finally {
      // Take the hermetic fixtures back out, dependents first. Audit rows are
      // append-only and stay, namespaced by the partner ids created here.
      await db
        .delete(reconciliationItems)
        .where(inArray(reconciliationItems.partnerId, [routableId, prospectId]));
      if (acct) await db.delete(connectedAccounts).where(eq(connectedAccounts.id, acct.id));
      for (const key of ['pullOperator', 'prospectOperator']) {
        const uid = ids[key];
        if (!uid) continue;
        await db.delete(session).where(eq(session.userId, uid));
        await db.delete(userRoles).where(eq(userRoles.userId, uid));
        await db.delete(user).where(eq(user.id, uid));
        delete ids[key];
      }
      await db.delete(partners).where(inArray(partners.id, [routableId, prospectId]));
    }
  });

  test('a product needs a name and a type CCN can act on', async () => {
    const bodies = [
      {},
      { name: '', type: 'fund' },
      { name: 'x', type: 'fund' },
      // Free text was accepted before, and produced a product the marketplace
      // could not filter or the suitability rules branch on.
      { name: 'A Fund', type: 'Real Estate' },
      { name: 'A Fund', type: 'fund', minInvestmentMinor: -1 },
      { name: 'A Fund', type: 'fund', risk: 'extremely high' },
    ];
    for (const body of bodies) {
      const res = await list(body);
      expect(res.status).toBe(400);
    }
  });
});
