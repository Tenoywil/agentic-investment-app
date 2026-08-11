import { kycStatus, riskProfiles, user, userProfiles } from '@ccn/db';
import {
  onboardingComplianceSchema,
  onboardingFundsSchema,
  onboardingIdentitySchema,
  onboardingRiskSchema,
} from '@ccn/domain';
import { eq } from 'drizzle-orm';
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
      const [risk] = await tx
        .select({ band: riskProfiles.band })
        .from(riskProfiles)
        .where(eq(riskProfiles.userId, tenant.user.id));
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
          isPep: false,
          taxResidencyDeclared: true,
        })
        .onConflictDoUpdate({
          target: kycStatus.userId,
          set: {
            complianceConfirmed: true,
            isPep: false,
            taxResidencyDeclared: true,
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
      await tx.delete(riskProfiles).where(eq(riskProfiles.userId, tenant.user.id));
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

  return app;
}
