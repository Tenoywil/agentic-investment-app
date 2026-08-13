import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createDb, holdings, partners, reconciliationItems, user, withRls } from '@ccn/db';
import { and, eq, sql } from 'drizzle-orm';
import { reconcileMatch, reconcileReject } from '../src/db-fns';
import { pullStatements } from '../src/services/ingestion';

/**
 * Statement-ingestion → reconciliation → holding, end to end against a migrated
 * Postgres. Pulls a sandbox partner's statements into pending items, then matches
 * one (creating a holding via the SECURITY DEFINER choke point) and rejects the
 * other — asserting the audit chain stays intact throughout.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;
const APP = 'ccn_app';
const NOW = () => Date.parse('2026-03-01T00:00:00.000Z');

function rows<T>(result: unknown): T[] {
  return result as T[];
}

suite('ingestion → reconciliation → holding', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 4 });
  const { db } = handle;
  const tag = `ingest-${Date.now()}`;
  let u1 = '';
  let ncbId = '';

  beforeAll(async () => {
    // NCB must be sandbox to be routable by the adapter registry.
    await db
      .insert(partners)
      .values({ code: 'NCB', name: 'National Commercial Bank', agreementStatus: 'sandbox' })
      .onConflictDoUpdate({ target: partners.code, set: { agreementStatus: 'sandbox' } });
    ncbId =
      (await db.select({ id: partners.id }).from(partners).where(eq(partners.code, 'NCB')))[0]
        ?.id ?? '';

    const [u] = await db
      .insert(user)
      .values({ name: 'Marcus', email: `${tag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    u1 = u?.id ?? '';
  });

  afterAll(async () => {
    await handle.close();
  });

  test('pull lands parsed statement lines as pending reconciliation items', async () => {
    const result = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      pullStatements(tx, { userId: u1, partnerCode: 'NCB', clientRef: 'Client ••0001', now: NOW }),
    );
    expect(result.created).toBe(2); // GOJ bond + USD chequing from the mock seed

    const pending = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx
        .select()
        .from(reconciliationItems)
        .where(and(eq(reconciliationItems.userId, u1), eq(reconciliationItems.status, 'pending'))),
    );
    expect(pending).toHaveLength(2);
  });

  test('a non-routable partner is refused by the registry', async () => {
    await db.update(partners).set({ agreementStatus: 'prospect' }).where(eq(partners.code, 'NCB'));
    await expect(
      withRls(db, { userId: u1, dbRole: APP }, (tx) =>
        pullStatements(tx, { userId: u1, partnerCode: 'NCB', clientRef: 'x', now: NOW }),
      ),
    ).rejects.toThrow(/not routable/);
    await db.update(partners).set({ agreementStatus: 'sandbox' }).where(eq(partners.code, 'NCB'));
  });

  test('matching an item creates the holding via the choke point; audit chain stays intact', async () => {
    const items = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      tx
        .select({ id: reconciliationItems.id })
        .from(reconciliationItems)
        .where(
          and(eq(reconciliationItems.partnerId, ncbId), eq(reconciliationItems.status, 'pending')),
        ),
    );
    expect(items.length).toBeGreaterThanOrEqual(2);
    const matchId = items[0]?.id ?? '';
    const rejectId = items[1]?.id ?? '';

    const holdingId = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      reconcileMatch(tx, matchId),
    );
    expect(holdingId).toBeTruthy();

    // The holding is visible to its owner and not to anyone else (RLS).
    const owned = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      tx.select().from(holdings).where(eq(holdings.id, holdingId)),
    );
    expect(owned).toHaveLength(1);
    expect(owned[0]?.userId).toBe(u1);

    await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      reconcileReject(tx, rejectId, 'duplicate'),
    );

    const ok = await db.execute(sql`select audit_verify() as ok`);
    expect(rows<{ ok: boolean }>(ok)[0]?.ok).toBe(true);
  });

  test('re-matching an already-matched item is refused', async () => {
    const matched = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      tx
        .select({ id: reconciliationItems.id })
        .from(reconciliationItems)
        .where(
          and(eq(reconciliationItems.partnerId, ncbId), eq(reconciliationItems.status, 'matched')),
        ),
    );
    const id = matched[0]?.id ?? '';
    // drizzle wraps the DB error as "Failed query: …" and puts the real text on
    // `.cause`, so match against both.
    let caught: { message?: string; cause?: unknown } | undefined;
    try {
      await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) => reconcileMatch(tx, id));
    } catch (err) {
      caught = err as { message?: string; cause?: unknown };
    }
    const text = `${caught?.message ?? ''} ${String((caught?.cause as { message?: string })?.message ?? '')}`;
    expect(text).toMatch(/not pending/);
  });
});
