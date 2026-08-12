import { type AllowlistConfig, demoCustomerAllowlist, operatorAllowlist } from '@ccn/config';
import { createDb, partners, userRoles, user as userTable } from '@ccn/db';
import { eq, inArray } from 'drizzle-orm';
import { createLogger } from '../logger';
import { ensureProvisioned } from '../provisioning';

/**
 * Pre-provision the allowlisted demo identities. `bun run grant` from apps/api.
 *
 * Role provisioning is lazy — it fires on a user's first authenticated request.
 * That is correct for production and wrong for a stage: the first request of the
 * demo is the one the audience is watching, and it would be the one carrying an
 * extra transaction, an advisory lock and (for a demo customer) a full portfolio
 * seed. This runs the same code path ahead of time so the live path is a no-op.
 *
 * It calls `ensureProvisioned` rather than reimplementing it, so what this
 * writes and what a real sign-in would write cannot drift apart.
 *
 * Idempotent, and safe to run against production: `ensureProvisioned` returns
 * early for any user who already holds a role.
 *
 * An allowlisted address with no `user` row yet is reported, not created —
 * Better Auth owns identity creation, and inventing a row here would produce an
 * account no Google sign-in could ever attach to.
 */
async function main() {
  // Reads only DATABASE_URL and the three allowlist variables rather than the
  // full validated ServerConfig: this touches no OAuth flow and no model, and
  // demanding GOOGLE_CLIENT_SECRET to write a role row would mean the safety
  // valve fails in exactly the situation it exists for.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const config: AllowlistConfig = {
    PARTNER_OPERATOR_EMAILS: process.env.PARTNER_OPERATOR_EMAILS ?? '',
    DEMO_CUSTOMER_EMAILS: process.env.DEMO_CUSTOMER_EMAILS ?? '',
    DEMO_PARTNER_CODE: process.env.DEMO_PARTNER_CODE ?? 'SAG',
  };
  const logger = createLogger({ level: 'info', base: { service: 'ccn-grant' } });
  const { db, client } = createDb(databaseUrl);

  // The same disjointness rule loadServerConfig enforces at startup. Re-checked
  // here because this path skips that validation, and an address in both lists
  // is the one mistake that silently lands the demo customer on the console.
  const overlap = [...demoCustomerAllowlist(config)].filter((e) =>
    operatorAllowlist(config).has(e),
  );
  if (overlap.length > 0) {
    throw new Error(
      `${overlap.join(', ')} appears in both allowlists; an email must be one surface`,
    );
  }

  const operators = operatorAllowlist(config);
  const demos = demoCustomerAllowlist(config);
  const emails = [...new Set([...operators.keys(), ...demos])];

  if (emails.length === 0) {
    console.log('No allowlisted emails. Set PARTNER_OPERATOR_EMAILS / DEMO_CUSTOMER_EMAILS.');
    await client.end();
    return;
  }

  // Better Auth lowercases nothing on write, so match case-insensitively rather
  // than assuming the stored casing matches what the allowlist was typed as.
  const rows = await db
    .select({ id: userTable.id, email: userTable.email, name: userTable.name })
    .from(userTable);
  const byEmail = new Map(rows.map((r) => [r.email.trim().toLowerCase(), r]));

  let missing = 0;
  for (const email of emails) {
    const found = byEmail.get(email);
    const intent = operators.has(email)
      ? `operator (${operators.get(email)?.partnerCode})`
      : 'demo customer';
    if (!found) {
      missing++;
      console.log(`  MISSING  ${email} — ${intent}; no account yet, sign in with it once first`);
      continue;
    }
    await ensureProvisioned({ db, config, logger }, found);
    console.log(`  ok       ${email} — ${intent}`);
  }

  // Report the resulting state rather than claiming success: the point of this
  // script is to be certain before the room, and "it ran" is not certainty.
  const ids = emails.map((e) => byEmail.get(e)?.id).filter((id): id is string => Boolean(id));
  if (ids.length > 0) {
    const granted = await db
      .select({
        userId: userRoles.userId,
        role: userRoles.role,
        partnerName: partners.name,
      })
      .from(userRoles)
      .leftJoin(partners, eq(userRoles.partnerId, partners.id))
      .where(inArray(userRoles.userId, ids));
    const emailById = new Map(rows.map((r) => [r.id, r.email]));
    console.log('\nRoles now held:');
    for (const g of granted) {
      const where = g.partnerName ? ` @ ${g.partnerName}` : '';
      console.log(`  ${emailById.get(g.userId)} -> ${g.role}${where}`);
    }
    const withoutRole = ids.filter((id) => !granted.some((g) => g.userId === id));
    for (const id of withoutRole) {
      console.log(`  ${emailById.get(id)} -> NONE (provisioning did not write a row)`);
    }
  }

  await client.end();
  if (missing > 0) process.exitCode = 1;
}

await main();
