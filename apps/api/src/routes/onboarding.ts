import { kycDocuments, kycDossiers, kycStatus, riskProfiles, user, userProfiles } from '@ccn/db';
import {
  kycDocumentSchema,
  onboardingComplianceSchema,
  onboardingFundsSchema,
  onboardingIdentitySchema,
  onboardingRiskSchema,
} from '@ccn/domain';
import type { FieldCipher } from '@ccn/security';
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
export function onboardingRoutes(
  deps: AppDeps,
  security: { fieldCipher?: FieldCipher } = {},
): Hono<AppEnv> {
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
    if (!security.fieldCipher) {
      return c.json({ error: 'secure KYC storage is temporarily unavailable' }, 503);
    }
    const identityCiphertext = await security.fieldCipher.encrypt(
      JSON.stringify(parsed.data),
      `kyc_dossiers.identity:${tenant.user.id}`,
    );

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
        .insert(kycDossiers)
        .values({
          userId: tenant.user.id,
          identityCiphertext,
          consentedAt: new Date(),
          nextReviewAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        })
        .onConflictDoUpdate({
          target: kycDossiers.userId,
          set: { identityCiphertext, consentedAt: new Date(), updatedAt: new Date() },
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
    if (!security.fieldCipher) {
      return c.json({ error: 'secure KYC storage is temporarily unavailable' }, 503);
    }
    const complianceCiphertext = await security.fieldCipher.encrypt(
      JSON.stringify(parsed.data),
      `kyc_dossiers.compliance:${tenant.user.id}`,
    );

    await withTenant(deps, tenant, async (tx) => {
      await tx
        .insert(kycStatus)
        .values({
          userId: tenant.user.id,
          complianceConfirmed: true,
          // What they actually declared. This was hardcoded `false`, so the
          // column recorded the same answer for everyone whether they had been
          // asked or not.
          isPep: parsed.data.pepStatus !== 'none',
          taxResidencyDeclared: parsed.data.taxResidencyDeclared,
        })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: {
            complianceConfirmed: true,
            isPep: parsed.data.pepStatus !== 'none',
            taxResidencyDeclared: parsed.data.taxResidencyDeclared,
            updatedAt: new Date(),
          },
        });
      await tx
        .insert(kycDossiers)
        .values({ userId: tenant.user.id, complianceCiphertext, consentedAt: new Date() })
        .onConflictDoUpdate({
          target: kycDossiers.userId,
          set: { complianceCiphertext, consentedAt: new Date(), updatedAt: new Date() },
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
    if (!security.fieldCipher) {
      return c.json({ error: 'secure KYC storage is temporarily unavailable' }, 503);
    }
    const fundsCiphertext = await security.fieldCipher.encrypt(
      JSON.stringify({
        ...parsed.data,
        expectedAnnualInvestmentMinor: parsed.data.expectedAnnualInvestmentMinor.toString(),
      }),
      `kyc_dossiers.funds:${tenant.user.id}`,
    );

    await withTenant(deps, tenant, async (tx) => {
      await tx
        .insert(kycStatus)
        .values({ userId: tenant.user.id, fundsConfirmed: true, sources, tier: 'tier2' })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: { fundsConfirmed: true, sources, tier: 'tier2', updatedAt: new Date() },
        });
      await tx
        .insert(kycDossiers)
        .values({ userId: tenant.user.id, fundsCiphertext, consentedAt: new Date() })
        .onConflictDoUpdate({
          target: kycDossiers.userId,
          set: { fundsCiphertext, consentedAt: new Date(), updatedAt: new Date() },
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
    if (!documentMatchesMime(bytes, parsed.data.mime)) {
      return c.json({ error: 'the file contents do not match the selected file type' }, 400);
    }

    const id = await withTenant(deps, tenant, async (tx) => {
      const [row] = await tx
        .insert(kycDocuments)
        .values({
          userId: tenant.user.id,
          step: parsed.data.step,
          documentType: parsed.data.documentType,
          label: parsed.data.label,
          issuingCountry: parsed.data.issuingCountry,
          expiresAt: parsed.data.expiresAt,
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
          documentType: kycDocuments.documentType,
          label: kycDocuments.label,
          issuingCountry: kycDocuments.issuingCountry,
          expiresAt: kycDocuments.expiresAt,
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
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  return app;
}

function documentMatchesMime(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'application/pdf') {
    return bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-';
  }
  if (mime === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => bytes[index] === byte);
  }
  if (mime === 'image/webp') {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    );
  }
  return false;
}
