import { createMiddleware } from 'hono/factory';
import type { AppDeps, AppEnv, TenantContext } from './context';
import { requireAuth } from './middleware';

/**
 * The one place a caller's surface is decided.
 *
 * CCN is two products behind one sign-in, and a user must never be able to
 * reach the other one. Every guard, redirect and `/api/me` response derives
 * from this single function so the customer app, the partner console and the
 * tests can never disagree about who someone is.
 */
export type Surface = 'customer' | 'institution';

export const PARTNER_OPERATOR = 'partner_operator';

/**
 * Total over every role combination — there is deliberately no "undecided" case
 * and no chooser UI:
 *
 * | roles                                    | surface     | why                                    |
 * |------------------------------------------|-------------|----------------------------------------|
 * | partner_operator WITH a partnerId        | institution | the operator's own book                |
 * | partner_operator WITHOUT a partnerId     | customer    | fail closed: unbound operator, no console |
 * | both operator and customer               | institution | one documented winner, never a prompt  |
 * | customer only                            | customer    |                                        |
 * | no rows at all                           | customer    | least privilege — absent data never grants console |
 */
export function surfaceFor(tenant: TenantContext): Surface {
  return tenant.roles.includes(PARTNER_OPERATOR) && tenant.partnerId ? 'institution' : 'customer';
}

/**
 * Customer-only routes. Rejects partner operators specifically — compliance and
 * admin users still pass, since they legitimately read customer-scoped data
 * through the gateway review queue.
 */
export function requireCustomer(deps: AppDeps) {
  const auth = requireAuth(deps);
  return createMiddleware<AppEnv>(async (c, next) => {
    // Hono's `next` must resolve to void, so the denial is captured rather than
    // returned from inside the auth continuation.
    let denied: Response | undefined;
    const res = await auth(c, async () => {
      const tenant = c.get('tenant');
      if (tenant && surfaceFor(tenant) === 'institution') {
        denied = c.json({ error: 'customer surface only' }, 403);
        return;
      }
      await next();
    });
    return denied ?? res;
  });
}

/**
 * Partner-console routes. Body and status match what `partnerScope()` in
 * routes/console.ts has always returned, so existing console tests are
 * unaffected by the move to a shared guard.
 */
export function requirePartnerOperator(deps: AppDeps) {
  const auth = requireAuth(deps);
  return createMiddleware<AppEnv>(async (c, next) => {
    let denied: Response | undefined;
    const res = await auth(c, async () => {
      const tenant = c.get('tenant');
      if (!tenant || surfaceFor(tenant) !== 'institution') {
        denied = c.json({ error: 'partner operator role required' }, 403);
        return;
      }
      await next();
    });
    return denied ?? res;
  });
}
