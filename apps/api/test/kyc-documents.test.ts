import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { loadServerConfig } from '@ccn/config';
import {
  connectedAccounts,
  createDb,
  kycDocuments,
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
 * KYC documents, file included (0027), proven at the HTTP boundary.
 *
 * The properties: an investor's upload comes back to them byte-for-byte; the
 * firm they are a client of can read it through the console; a firm they have
 * no relationship with gets the same 404 as for a document that does not
 * exist; and the 2MB cap refuses before the database does.
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

suite('kyc documents', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `kycdoc-${Date.now()}`;

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
  // A tiny "PDF": what matters is the bytes surviving the round trip exactly.
  const FILE_BYTES = new TextEncoder().encode(`%PDF-1.4 ${tag} payslip`);
  const FILE_B64 = btoa(String.fromCharCode(...FILE_BYTES));

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

  beforeAll(async () => {
    const rows = await db
      .select({ id: partners.id, code: partners.code })
      .from(partners)
      .where(inArray(partners.code, ['SAG', 'NCB']));
    sagId = rows.find((p) => p.code === 'SAG')?.id ?? '';
    ncbId = rows.find((p) => p.code === 'NCB')?.id ?? '';
    expect(sagId && ncbId).toBeTruthy();

    await makeUser('investor');
    await makeUser('sagOperator', sagId);
    await makeUser('ncbOperator', ncbId);

    // The investor is SAG's pending client — pending, because review is
    // exactly when the desk needs to see the documents.
    const [account] = await db
      .insert(connectedAccounts)
      .values({ userId: ids.investor ?? '', partnerId: sagId, label: tag, status: 'pending' })
      .returning({ id: connectedAccounts.id });
    accountId = account?.id ?? '';
  });

  afterAll(async () => {
    const all = Object.values(ids);
    if (all.length > 0) {
      await db.delete(kycDocuments).where(inArray(kycDocuments.userId, all));
      await db.delete(session).where(inArray(session.userId, all));
      await db.delete(userRoles).where(inArray(userRoles.userId, all));
      await db.delete(user).where(inArray(user.id, all));
    }
    await handle.close();
  });

  let docId = '';

  test('upload, list, and byte-exact download for the owner', async () => {
    const res = await request('/api/onboarding/documents', 'investor', {
      method: 'POST',
      body: JSON.stringify({
        step: 'funds',
        label: 'payslip.pdf',
        mime: 'application/pdf',
        data: FILE_B64,
      }),
    });
    expect(res.status).toBe(201);
    docId = ((await res.json()) as { id: string }).id;
    expect(docId).toBeTruthy();

    const list = await request('/api/onboarding/documents', 'investor');
    const { documents } = (await list.json()) as { documents: { id: string; label: string }[] };
    expect(documents.some((d) => d.id === docId && d.label === 'payslip.pdf')).toBe(true);

    const dl = await request(`/api/onboarding/documents/${docId}`, 'investor');
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(FILE_BYTES);
  });

  test('the reviewing firm reads it; a stranger firm gets the same 404 as nothing', async () => {
    const detail = await request(`/api/console/clients/${accountId}`, 'sagOperator');
    expect(detail.status).toBe(200);
    const { documents } = (await detail.json()) as { documents: { id: string }[] };
    expect(documents.some((d) => d.id === docId)).toBe(true);

    const dl = await request(`/api/console/clients/${accountId}/documents/${docId}`, 'sagOperator');
    expect(dl.status).toBe(200);
    expect(new Uint8Array(await dl.arrayBuffer())).toEqual(FILE_BYTES);

    // NCB has no relationship with this person: the account is not in their
    // book, so the route cannot even name it — indistinguishable from absent.
    const foreign = await request(
      `/api/console/clients/${accountId}/documents/${docId}`,
      'ncbOperator',
    );
    expect(foreign.status).toBe(404);
  });

  test('the 2MB cap refuses an oversized upload with a plain sentence', async () => {
    const big = btoa('x'.repeat(2_100_000));
    const res = await request('/api/onboarding/documents', 'investor', {
      method: 'POST',
      body: JSON.stringify({
        step: 'identity',
        label: 'huge.png',
        mime: 'image/png',
        data: big,
      }),
    });
    expect([400, 413]).toContain(res.status);
  });
});
