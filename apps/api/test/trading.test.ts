import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  connectedAccounts,
  createDb,
  holdings,
  instruments,
  limits,
  partners,
  riskProfiles,
  user,
  withRls,
} from '@ccn/db';
import { eq, sql } from 'drizzle-orm';
import { acceptOrder, createOrder, settleOrder } from '../src/db-fns';
import { loadInstrument, runGate } from '../src/services/gate';
import { startEventBridge } from '../src/ws/bridge';
import { WsHub } from '../src/ws/hub';

/**
 * End-to-end trading tests against a migrated Postgres (CI provides one; locally,
 * export DATABASE_URL). Exercises the real seam: assemble the Limits Engine input
 * from live tenant data, gate a proposal, drive it through the create_order choke
 * point and the accept/settle transitions, and observe the realtime NOTIFY.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;
const APP = 'ccn_app';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await wait(25);
  }
}

suite('trading: gate → order → accept → settle + realtime', () => {
  const handle = createDb(DATABASE_URL ?? '', { max: 6 });
  const { db } = handle;
  const tag = `trade-${Date.now()}`;

  let u1 = '';
  let ncbId = '';
  let sygId = '';
  let mmfId = '';
  let gojId = '';
  let sigmaId = '';
  let villaId = '';

  beforeAll(async () => {
    await db
      .insert(partners)
      .values([
        { code: 'NCB', name: 'National Commercial Bank' },
        { code: 'SYG', name: 'Sygnus Capital' },
      ])
      .onConflictDoNothing({ target: partners.code });
    const prows = await db.select({ id: partners.id, code: partners.code }).from(partners);
    ncbId = prows.find((p) => p.code === 'NCB')?.id ?? '';
    sygId = prows.find((p) => p.code === 'SYG')?.id ?? '';

    const [u] = await db
      .insert(user)
      .values({ name: 'Marcus', email: `${tag}@x.com`, emailVerified: true })
      .returning({ id: user.id });
    u1 = u?.id ?? '';

    const ins = await db
      .insert(instruments)
      .values([
        {
          slug: `${tag}-mmf`,
          abbr: 'MMF',
          type: 'fund',
          partnerId: ncbId,
          risk: 'low',
          name: 'NCB Money Market',
          minInvestmentMinor: 10_000n,
        },
        {
          slug: `${tag}-goj`,
          abbr: 'GOJ',
          type: 'bond',
          partnerId: ncbId,
          risk: 'low',
          name: 'GOJ Bond 2032',
          minInvestmentMinor: 100_000n,
        },
        {
          slug: `${tag}-sig`,
          abbr: 'SIG',
          type: 'fund',
          partnerId: ncbId,
          risk: 'medium',
          name: 'Sigma Global',
          minInvestmentMinor: 10_000n,
        },
        {
          slug: `${tag}-villa`,
          abbr: 'BVD',
          type: 'private',
          partnerId: sygId,
          risk: 'high',
          name: 'Beachfront Villas Note',
          minInvestmentMinor: 2_500_000n,
          blocked: true,
          blockReasons: [
            'High risk vs your balanced-income profile',
            '80% of your portfolio, above your 15% cap',
          ],
        },
      ])
      .returning({ id: instruments.id, slug: instruments.slug });
    mmfId = ins.find((i) => i.slug.endsWith('-mmf'))?.id ?? '';
    gojId = ins.find((i) => i.slug.endsWith('-goj'))?.id ?? '';
    sigmaId = ins.find((i) => i.slug.endsWith('-sig'))?.id ?? '';
    villaId = ins.find((i) => i.slug.endsWith('-villa'))?.id ?? '';

    const [acct] = await db
      .insert(connectedAccounts)
      .values({ userId: u1, partnerId: ncbId, label: 'NCB' })
      .returning({ id: connectedAccounts.id });
    await db.insert(holdings).values([
      {
        userId: u1,
        connectedAccountId: acct?.id ?? '',
        instrumentId: null,
        name: 'USD Chequing',
        valueMinor: 500_000n,
      }, // US$5,000 cash
      {
        userId: u1,
        connectedAccountId: acct?.id ?? '',
        instrumentId: sigmaId,
        name: 'Sigma Global',
        valueMinor: 820_000n,
      }, // US$8,200
    ]);
    await db.insert(limits).values({ userId: u1 }); // schema defaults
    await db
      .insert(riskProfiles)
      .values({ userId: u1, answers: {}, score: 9, band: 'high_moderate' });
  });

  afterAll(async () => {
    await handle.close();
  });

  test('a small low-risk sweep is auto-act', async () => {
    const decision = await withRls(db, { userId: u1, dbRole: APP }, async (tx) => {
      const instrument = await loadInstrument(tx, mmfId);
      if (!instrument) throw new Error('instrument missing');
      return runGate(tx, { userId: u1, instrument, amountMinor: 40_000n, currency: 'USD' });
    });
    expect(decision.decision).toBe('auto_act');
  });

  test('a blocked instrument returns its curated reasons', async () => {
    const decision = await withRls(db, { userId: u1, dbRole: APP }, async (tx) => {
      const instrument = await loadInstrument(tx, villaId);
      if (!instrument) throw new Error('instrument missing');
      return runGate(tx, { userId: u1, instrument, amountMinor: 2_500_000n, currency: 'USD' });
    });
    expect(decision.decision).toBe('blocked');
    if (decision.decision === 'blocked') {
      expect(decision.code).toBe('instrument_blocked');
      expect(decision.reasons.length).toBe(2);
    }
  });

  test('an amount above the approval threshold requires approval', async () => {
    const decision = await withRls(db, { userId: u1, dbRole: APP }, async (tx) => {
      const instrument = await loadInstrument(tx, gojId);
      if (!instrument) throw new Error('instrument missing');
      return runGate(tx, { userId: u1, instrument, amountMinor: 150_000n, currency: 'USD' });
    });
    expect(decision.decision).toBe('requires_approval');
    if (decision.decision === 'requires_approval')
      expect(decision.code).toBe('above_approval_threshold');
  });

  test('below the instrument minimum is blocked', async () => {
    const decision = await withRls(db, { userId: u1, dbRole: APP }, async (tx) => {
      const instrument = await loadInstrument(tx, gojId);
      if (!instrument) throw new Error('instrument missing');
      return runGate(tx, { userId: u1, instrument, amountMinor: 5_000n, currency: 'USD' });
    });
    expect(decision.decision).toBe('blocked');
    if (decision.decision === 'blocked') expect(decision.code).toBe('below_minimum');
  });

  test('create_order → accept → settle drives the state machine', async () => {
    const created = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      createOrder(tx, {
        userId: u1,
        partnerId: ncbId,
        instrumentId: mmfId,
        approvalId: null,
        amountMinor: 40_000n,
        currency: 'USD',
        idempotencyKey: `${tag}-o1`,
        clientRef: 'Client ••0001',
        createdBy: 'user',
      }),
    );
    expect(created.status).toBe('created');
    expect(created.amount_minor).toBe('40000');

    // Idempotent replay returns the same order, not a duplicate.
    const replay = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      createOrder(tx, {
        userId: u1,
        partnerId: ncbId,
        instrumentId: mmfId,
        approvalId: null,
        amountMinor: 40_000n,
        currency: 'USD',
        idempotencyKey: `${tag}-o1`,
        clientRef: 'Client ••0001',
        createdBy: 'user',
      }),
    );
    expect(replay.id).toBe(created.id);

    const accepted = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      acceptOrder(tx, created.id, ncbId),
    );
    expect(accepted.status).toBe('accepted');

    const settled = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      settleOrder(tx, created.id, ncbId),
    );
    expect(settled.status).toBe('settled');

    /**
     * Settlement moves the money (0024). Before it, an order the platform
     * itself routed settled into nothing: no position appeared and cash never
     * fell, so investing looked like a story whose ending never arrived. The
     * US$400 MMF order becomes a US$400 MMF holding, and the cash it was paid
     * from drops from US$5,000 to US$4,600.
     */
    const rows = await db
      .select({
        instrumentId: holdings.instrumentId,
        valueMinor: holdings.valueMinor,
        name: holdings.name,
      })
      .from(holdings)
      .where(eq(holdings.userId, u1));
    const position = rows.find((h) => h.instrumentId === mmfId);
    expect(position?.valueMinor).toBe(40_000n);
    expect(position?.name).toBe('NCB Money Market');
    const cash = rows.find((h) => h.instrumentId === null);
    expect(cash?.valueMinor).toBe(460_000n);
  });

  /**
   * What the firm actually did.
   *
   * `settle_order` used to write status, settled_at and updated_at, so an
   * investor was told "settled" and never at what price — a claim about their
   * money with nothing behind it. Accepting had the mirror problem:
   * `settlement_eta` existed from the first migration, the exec dialog told
   * every investor the firm set it on acceptance, and nothing wrote it.
   */
  test('accepting commits to a date and settling records the execution', async () => {
    const created = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      createOrder(tx, {
        userId: u1,
        partnerId: ncbId,
        instrumentId: mmfId,
        approvalId: null,
        amountMinor: 500_000n,
        currency: 'USD',
        idempotencyKey: `${tag}-detail`,
        clientRef: 'Client ••0002',
        createdBy: 'user',
      }),
    );

    const eta = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const accepted = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      acceptOrder(tx, created.id, ncbId, eta),
    );
    expect(accepted.settlement_eta).not.toBeNull();
    expect(new Date(accepted.settlement_eta as string).toISOString()).toBe(eta);

    const settled = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      settleOrder(tx, created.id, ncbId, {
        unitPriceMinor: 10_025n,
        units: '49.875',
        feeMinor: 0n,
        externalRef: 'TRD-88214',
      }),
    );
    expect(settled.status).toBe('settled');
    expect(settled.unit_price_minor).toBe('10025');
    expect(Number(settled.units)).toBe(49.875);
    // Zero survives as zero: the firm stating it charged no fee is a different
    // claim from the firm not telling us, and the column has to keep them apart.
    expect(settled.fee_minor).toBe('0');
    expect(settled.external_ref).toBe('TRD-88214');

    // The figures are on the audit row too — the columns are the current
    // truth, the audit row is what was true at the moment of settlement.
    const [audited] = (await db.execute(
      sql`select detail from audit_log where entity_id = ${created.id}::uuid and action = 'order.settled'`,
    )) as unknown as { detail: Record<string, unknown> }[];
    expect(audited?.detail.unit_price_minor).toBe('10025');
    expect(audited?.detail.external_ref).toBe('TRD-88214');
  });

  test('settling without a report is still allowed, and invents nothing', async () => {
    const created = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      createOrder(tx, {
        userId: u1,
        partnerId: ncbId,
        instrumentId: mmfId,
        approvalId: null,
        amountMinor: 60_000n,
        currency: 'USD',
        idempotencyKey: `${tag}-nodetail`,
        clientRef: 'Client ••0003',
        createdBy: 'user',
      }),
    );
    await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      acceptOrder(tx, created.id, ncbId),
    );
    const settled = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      settleOrder(tx, created.id, ncbId),
    );
    expect(settled.status).toBe('settled');
    // Null, not zero. A firm that reports nothing must not have a price
    // written on its behalf.
    expect(settled.unit_price_minor).toBeNull();
    expect(settled.units).toBeNull();
    expect(settled.fee_minor).toBeNull();
  });

  test('a negative figure is refused rather than stored', async () => {
    const created = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      createOrder(tx, {
        userId: u1,
        partnerId: ncbId,
        instrumentId: mmfId,
        approvalId: null,
        amountMinor: 60_000n,
        currency: 'USD',
        idempotencyKey: `${tag}-negative`,
        clientRef: 'Client ••0004',
        createdBy: 'user',
      }),
    );
    await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      acceptOrder(tx, created.id, ncbId),
    );
    await expect(
      withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
        settleOrder(tx, created.id, ncbId, {
          unitPriceMinor: -1n,
          units: null,
          feeMinor: null,
          externalRef: null,
        }),
      ),
    ).rejects.toThrow();
    // And the order is still acceptable-and-settleable, not stuck.
    const settled = await withRls(db, { partnerId: ncbId, dbRole: APP }, (tx) =>
      settleOrder(tx, created.id, ncbId),
    );
    expect(settled.status).toBe('settled');
  });

  test('a wrong-partner accept is refused by the guarded transition', async () => {
    const created = await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
      createOrder(tx, {
        userId: u1,
        partnerId: ncbId,
        instrumentId: mmfId,
        approvalId: null,
        amountMinor: 20_000n,
        currency: 'USD',
        idempotencyKey: `${tag}-o2`,
        clientRef: 'Client ••0001',
        createdBy: 'user',
      }),
    );
    // SYG cannot accept an NCB order.
    await expect(
      withRls(db, { partnerId: sygId, dbRole: APP }, (tx) => acceptOrder(tx, created.id, sygId)),
    ).rejects.toThrow();
  });

  test('create_order emits a realtime event to the order owner', async () => {
    const hub = new WsHub();
    const received: string[] = [];
    hub.add({ send: (d) => received.push(d) }, { userId: u1 });
    const stop = await startEventBridge(handle.client, hub);
    try {
      await withRls(db, { userId: u1, dbRole: APP }, (tx) =>
        createOrder(tx, {
          userId: u1,
          partnerId: ncbId,
          instrumentId: mmfId,
          approvalId: null,
          amountMinor: 15_000n,
          currency: 'USD',
          idempotencyKey: `${tag}-notify`,
          clientRef: 'Client ••0001',
          createdBy: 'user',
        }),
      );
      await waitFor(() => received.length > 0, 3000);
      expect(received.length).toBeGreaterThan(0);
      expect(JSON.parse(received[0] ?? '{}')).toMatchObject({ type: 'order.created', user_id: u1 });
    } finally {
      await stop();
    }
  });
});
