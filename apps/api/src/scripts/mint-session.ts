/**
 * Mint local sign-in cookies for the browser journey (apps/web/e2e).
 *
 * Sign-in is Google-only, which a headless browser cannot complete, so the
 * journey needs a session it did not obtain by signing in. This writes one the
 * same way the API's own tests do — a `session` row plus the HMAC-signed cookie
 * Better Auth expects — and prints the cookie values.
 *
 * LOCAL ONLY, and it refuses to run otherwise: it fabricates authentication,
 * which is exactly the thing that must never be possible against a real
 * database. It also refuses a DATABASE_URL that is not on localhost, because
 * "I pointed it at the wrong database" is the mistake worth making impossible
 * rather than merely unlikely.
 *
 *   cd apps/api && bun run mint-session
 */
import { createDb, partners, session, user, userRoles } from '@ccn/db';
import { eq } from 'drizzle-orm';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:5432/ccn';
const SECRET = process.env.BETTER_AUTH_SECRET ?? 'x'.repeat(32);
const PARTNER_CODE = process.env.E2E_PARTNER_CODE ?? 'SAG';

if (process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production') {
  throw new Error('mint-session fabricates a session and must never run against production');
}
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL)) {
  throw new Error(`mint-session refuses a non-local DATABASE_URL (${DATABASE_URL.split('@')[1]})`);
}

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

const { db, client } = createDb(DATABASE_URL);

const [partner] = await db
  .select({ id: partners.id })
  .from(partners)
  .where(eq(partners.code, PARTNER_CODE));
if (!partner) throw new Error(`no partner ${PARTNER_CODE}; run the seed first`);

for (const role of ['operator', 'investor'] as const) {
  const email = `e2e-${role}@example.com`;
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
  const id =
    existing?.id ??
    (
      await db
        .insert(user)
        .values({ name: `e2e ${role}`, email, emailVerified: true })
        .returning({ id: user.id })
    )[0]?.id;
  if (!id) throw new Error(`could not create the ${role} user`);

  // Re-granted every run: the role is what decides which surface the journey
  // lands on, and a leftover grant from a previous run is a silent wrong turn.
  await db.delete(userRoles).where(eq(userRoles.userId, id));
  await db
    .insert(userRoles)
    .values(
      role === 'operator'
        ? { userId: id, role: 'partner_operator' as const, partnerId: partner.id }
        : { userId: id, role: 'customer' as const },
    );

  const token = `e2e-${role}-token`;
  await db.delete(session).where(eq(session.token, token));
  await db
    .insert(session)
    .values({ userId: id, token, expiresAt: new Date(Date.now() + 86_400_000) });

  console.log(`${role.toUpperCase()}_COOKIE=${await signCookie(token, SECRET)}`);
}

await client.end({ timeout: 5 });
