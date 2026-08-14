import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import {
  createDb,
  instruments,
  orders,
  partners,
  productListings,
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

  /** A partner operator bound to `partnerId`, with a live session cookie. */
  async function makeOperator(key: string, partnerId: string) {
    const [row] = await db
      .insert(user)
      .values({ name: key, email: `${tag}-${key}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    const id = row?.id ?? '';
    ids[key] = id;
    await db
      .insert(userRoles)
      .values({ userId: id, role: 'partner_operator', partnerId })
      .onConflictDoNothing();
    const token = `${tag}-${key}-token`;
    await db
      .insert(session)
      .values({ userId: id, token, expiresAt: new Date(Date.now() + 3_600_000) });
    cookies[key] = `ccn.session_token=${await signCookie(token, SECRET)}`;
  }

  beforeAll(async () => {
    // Two partners: the caller's, and the one whose data must never leak.
    for (const p of [
      { code: 'SAG' as const, name: 'Sagicor Investments' },
      { code: 'NCB' as const, name: 'National Commercial Bank' },
    ]) {
      await db.insert(partners).values(p).onConflictDoNothing({ target: partners.code });
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

    const [listing] = await db
      .insert(productListings)
      .values({ partnerId: sagId, name: `${tag} listing`, type: 'Bond', status: 'live' })
      .returning({ id: productListings.id });
    listingId = listing?.id ?? '';

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
    if (listingId) await db.delete(productListings).where(eq(productListings.id, listingId));
    if (instrumentId) await db.delete(instruments).where(eq(instruments.id, instrumentId));
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
      .select({ status: productListings.status })
      .from(productListings)
      .where(eq(productListings.id, listingId));
    expect(row?.status).toBe('live');
  });

  /**
   * Listing a product. The console could read its catalogue and pause a
   * listing and never create one, so every product on the network came from
   * the seed — a partner onboarded onto a live network had no way to put
   * anything on it.
   *
   * The property worth pinning is that `partner_id` comes from the caller's
   * scope and never from the body: an operator lists for their own firm or not
   * at all, whatever they send.
   */
  test('an operator lists a product, for their own partner only', async () => {
    // 201, so this cannot go through the 200-asserting `json` helper.
    const list = (body: unknown, who = 'sagOperator') =>
      app().request('/api/console/products', {
        method: 'POST',
        headers: { cookie: cookies[who] ?? '', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    const res = await list({ name: 'A New Fund', type: 'Fund' });
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      product: { id: string; partnerId: string; status: string };
    };
    expect(created.product.status).toBe('live');

    // It is in this partner's catalogue, and not in the other partner's.
    const mine = await json<{ products: { id: string }[] }>('/api/console/products', 'sagOperator');
    expect(mine.products.some((p) => p.id === created.product.id)).toBe(true);
    const theirs = await json<{ products: { id: string }[] }>(
      '/api/console/products',
      'ncbOperator',
    );
    expect(theirs.products.some((p) => p.id === created.product.id)).toBe(false);

    // A partnerId in the body is ignored — the scope decides.
    const forgedRes = await list({
      name: 'Forged',
      partnerId: '00000000-0000-0000-0000-000000000000',
    });
    expect(forgedRes.status).toBe(201);
    const forged = (await forgedRes.json()) as { product: { partnerId: string } };
    expect(forged.product.partnerId).toBe(created.product.partnerId);
  });

  test('a product needs a name', async () => {
    for (const body of [{}, { name: '' }, { name: 'x' }]) {
      const res = await app().request('/api/console/products', {
        method: 'POST',
        headers: { cookie: cookies.sagOperator ?? '', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });
});
