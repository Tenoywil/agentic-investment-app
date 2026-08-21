import { kycDocuments, kycStatus, riskProfiles, user, userProfiles } from '@ccn/db';
import {
  kycDocumentSchema,
  onboardingComplianceSchema,
  onboardingFundsSchema,
  onboardingIdentitySchema,
  onboardingRiskSchema,
} from '@ccn/domain';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { auditAppend } from '../db-fns';
import { requireAuth } from '../middleware';

const RISK_BANDS = ['low', 'low_moderate', 'high_moderate', 'low_high', 'high'] as const;
type RiskBand = (typeof RISK_BANDS)[number];

/** Average the three 1-5 scores, rounded, mapped to the DB's risk_band enum. */
function scoresToBand(scores: readonly number[]): RiskBand {
  const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  return RISK_BANDS[Math.min(Math.max(avg, 1), 5) - 1] ?? 'high_moderate';
}

/**
 * The onboarding wizard: Identity -> Compliance -> Risk -> Funds, one request
 * per step (packages/db/src/schema/identity.ts). CCN is not the KYC owner —
 * this records the caller's own declarations and the derived suitability band,
 * consent-based, not a document-verification pipeline (that stays with the
 * partner). GET /status lets the wizard resume after a reload.
 */
export function onboardingRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', requireAuth(deps));

  app.get('/status', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const data = await withTenant(deps, tenant, async (tx) => {
      const [status] = await tx
        .select()
        .from(kycStatus)
        .where(eq(kycStatus.userId, tenant.user.id));
      const [profile] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, tenant.user.id));
      // Newest assessment wins; earlier ones are kept for the audit trail.
      const [risk] = await tx
        .select({ band: riskProfiles.band })
        .from(riskProfiles)
        .where(eq(riskProfiles.userId, tenant.user.id))
        .orderBy(desc(riskProfiles.createdAt))
        .limit(1);
      return { status: status ?? null, profile: profile ?? null, riskBand: risk?.band ?? null };
    });
    return c.json(data);
  });

  app.post('/identity', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = onboardingIdentitySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const { fullName, residencyCountry, occupation } = parsed.data;

    await withTenant(deps, tenant, async (tx) => {
      await tx
        .update(user)
        .set({ name: fullName, updatedAt: new Date() })
        .where(eq(user.id, tenant.user.id));
      await tx
        .insert(userProfiles)
        .values({ userId: tenant.user.id, residencyCountry, occupation })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { residencyCountry, occupation, updatedAt: new Date() },
        });
      await tx
        .insert(kycStatus)
        // Legacy column name: true means identity intake is recorded. It is
        // not a document-verification result; the licensed partner owns that.
        .values({ userId: tenant.user.id, identityVerified: true, tier: 'tier1' })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: { identityVerified: true, updatedAt: new Date() },
        });
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'onboarding.identity',
        entityType: 'kyc_status',
        entityId: tenant.user.id,
        detail: {},
      });
    });
    return c.json({ ok: true });
  });

  app.post('/compliance', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = onboardingComplianceSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    await withTenant(deps, tenant, async (tx) => {
      await tx
        .insert(kycStatus)
        .values({
          userId: tenant.user.id,
          complianceConfirmed: true,
          // What they actually declared. This was hardcoded `false`, so the
          // column recorded the same answer for everyone whether they had been
          // asked or not.
          isPep: parsed.data.isPoliticallyExposed,
          taxResidencyDeclared: parsed.data.taxResidencyDeclared,
        })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: {
            complianceConfirmed: true,
            isPep: parsed.data.isPoliticallyExposed,
            taxResidencyDeclared: parsed.data.taxResidencyDeclared,
            updatedAt: new Date(),
          },
        });
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'onboarding.compliance',
        entityType: 'kyc_status',
        entityId: tenant.user.id,
        detail: {},
      });
    });
    return c.json({ ok: true });
  });

  app.post('/risk', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = onboardingRiskSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const { scores } = parsed.data;
    const band = scoresToBand(scores);
    const score = scores.reduce((a, b) => a + b, 0);

    await withTenant(deps, tenant, async (tx) => {
      /**
       * Appended, not replaced.
       *
       * This used to delete the previous assessment first, which meant the risk
       * step returned 500 to every investor who ever reached it: the app role
       * has no DELETE on `risk_profiles` and never had — deletes are granted
       * exactly once in this system, on `user_roles`, and that is deliberate.
       * So onboarding could not complete on any database, which is what made
       * `/api/me` report `complete: false` forever.
       *
       * Appending is also the right answer independently. A fact-find is a
       * point-in-time record of what someone said about their tolerance on a
       * date, and a firm that has to justify a suitability decision needs the
       * assessment that was current when the order was placed — not whatever
       * the client answered most recently. Every reader takes the newest row.
       */
      await tx.insert(riskProfiles).values({
        userId: tenant.user.id,
        answers: { q1: scores[0], q2: scores[1], q3: scores[2] },
        score,
        band,
      });
      await tx
        .insert(kycStatus)
        .values({ userId: tenant.user.id, riskCompleted: true })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: { riskCompleted: true, updatedAt: new Date() },
        });
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'onboarding.risk',
        entityType: 'risk_profile',
        entityId: tenant.user.id,
        detail: { band },
      });
    });
    return c.json({ band });
  });

  app.post('/funds', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = onboardingFundsSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const { sources } = parsed.data;

    await withTenant(deps, tenant, async (tx) => {
      await tx
        .insert(kycStatus)
        .values({ userId: tenant.user.id, fundsConfirmed: true, sources, tier: 'tier2' })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: { fundsConfirmed: true, sources, tier: 'tier2', updatedAt: new Date() },
        });
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'onboarding.funds',
        entityType: 'kyc_status',
        entityId: tenant.user.id,
        detail: { sources },
      });
    });
    return c.json({ ok: true, tier: 'tier2' });
  });

  /**
   * A KYC document, file included.
   *
   * The table has existed since 0000 as metadata pointing at a Storage bucket
   * nobody built, so the KYC package a firm reviews carried declarations with
   * nothing behind them. The bytes live in the row now (≤2MB, CHECK-enforced),
   * under the same RLS as everything else about the person: the owner, CCN
   * admin, and the firm they are a pending/active client of.
   */
  app.post('/documents', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = kycDocumentSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(parsed.data.data), (ch) => ch.charCodeAt(0));
    } catch {
      return c.json({ error: 'the file data is not valid base64' }, 400);
    }
    if (bytes.length === 0) return c.json({ error: 'the file is empty' }, 400);
    if (bytes.length > 2 * 1024 * 1024) {
      return c.json({ error: 'documents are capped at 2MB — send a smaller scan' }, 413);
    }

    const id = await withTenant(deps, tenant, async (tx) => {
      const [row] = await tx
        .insert(kycDocuments)
        .values({
          userId: tenant.user.id,
          step: parsed.data.step,
          label: parsed.data.label,
          mime: parsed.data.mime,
          bytes,
        })
        .returning({ id: kycDocuments.id });
      await auditAppend(tx, {
        actorType: 'user',
        actorId: tenant.user.id,
        userId: tenant.user.id,
        partnerId: null,
        action: 'onboarding.document_uploaded',
        entityType: 'kyc_documents',
        entityId: row?.id ?? null,
        detail: { step: parsed.data.step, label: parsed.data.label, size: bytes.length },
      });
      return row?.id ?? null;
    });
    return c.json({ id }, 201);
  });

  /** The caller's own documents — metadata only, never the bytes in a list. */
  app.get('/documents', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          id: kycDocuments.id,
          step: kycDocuments.step,
          label: kycDocuments.label,
          mime: kycDocuments.mime,
          createdAt: kycDocuments.createdAt,
        })
        .from(kycDocuments)
        .where(eq(kycDocuments.userId, tenant.user.id))
        .orderBy(desc(kycDocuments.createdAt)),
    );
    return c.json({ documents: rows });
  });

  /** One document's bytes, for the owner. Firms read through the console. */
  app.get('/documents/:id', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const [row] = await withTenant(deps, tenant, (tx) =>
      tx
        .select({ mime: kycDocuments.mime, bytes: kycDocuments.bytes, label: kycDocuments.label })
        .from(kycDocuments)
        .where(
          and(eq(kycDocuments.id, c.req.param('id')), eq(kycDocuments.userId, tenant.user.id)),
        ),
    );
    if (!row?.bytes) return c.json({ error: 'document not found' }, 404);
    return new Response(new Uint8Array(row.bytes), {
      headers: {
        'Content-Type': row.mime ?? 'application/octet-stream',
        // Attachment, not inline: nothing a person uploaded executes or renders
        // in this origin's context.
        'Content-Disposition': `attachment; filename="${row.label.replace(/[^\w. -]/g, '_')}"`,
      },
    });
  });

  return app;
}
