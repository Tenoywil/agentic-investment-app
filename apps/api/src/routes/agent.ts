import { type ChatMessage, ResponseCache, buildContext, runAgent } from '@ccn/agent';
import { agentMessages } from '@ccn/db';
import { agentMessageSchema } from '@ccn/domain';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { requireAuth } from '../middleware';
import { createOutboundGuard } from '../security';
import { loadAgentSnapshot } from '../services/agent-snapshot';

/**
 * The Capital Agent chat. POST /message streams the reply over SSE while the
 * read/propose-only agent loop runs against the AI gateway; both
 * sides of the turn persist to agent_messages. The agent can only PROPOSE — the
 * Limits Engine and the human approval loop remain the only paths to execution.
 *
 * A process-local response cache reuses answers to identical turns, scoped per
 * user + portfolio fingerprint so answers are never shared across tenants.
 */
export function agentRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cache = new ResponseCache<string>(256);
  // Every outbound gateway call is allowlisted and checked for private addresses.
  const outbound = createOutboundGuard(deps.config);
  app.use('*', requireAuth(deps));

  app.get('/history', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const rows = await withTenant(deps, tenant, (tx) =>
      tx
        .select({
          role: agentMessages.role,
          content: agentMessages.content,
          createdAt: agentMessages.createdAt,
        })
        .from(agentMessages)
        .where(eq(agentMessages.userId, tenant.user.id))
        .orderBy(desc(agentMessages.createdAt))
        .limit(50),
    );
    return c.json({ messages: rows.reverse() });
  });

  app.post('/message', async (c) => {
    const tenant = c.get('tenant');
    if (!tenant) return c.json({ error: 'authentication required' }, 401);
    const parsed = agentMessageSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400);
    const { message } = parsed.data;

    // Short tx: snapshot + prior turns, then persist the user message.
    const { snapshot, history } = await withTenant(deps, tenant, async (tx) => {
      const snap = await loadAgentSnapshot(tx, tenant.user.id);
      const rows = await tx
        .select({ role: agentMessages.role, content: agentMessages.content })
        .from(agentMessages)
        .where(eq(agentMessages.userId, tenant.user.id))
        .orderBy(desc(agentMessages.createdAt))
        .limit(20);
      await tx
        .insert(agentMessages)
        .values({ userId: tenant.user.id, role: 'user', content: message });
      const hist: ChatMessage[] = rows
        .reverse()
        .map((r) => ({ role: r.role === 'agent' ? 'assistant' : 'user', content: r.content }));
      return { snapshot: snap, history: hist };
    });

    // streamText reports a failed request here and then ends the stream
    // normally, so this is the only place the real cause is available.
    let gatewayError: unknown = null;
    const { textStream } = runAgent({
      onError: (error) => {
        gatewayError = error;
      },
      gateway: {
        baseURL: deps.config.OPENAI_BASE_URL,
        apiKey: deps.config.OPENAI_API_KEY,
        model: deps.config.AI_MODEL,
        // All gateway traffic goes through the SSRF allowlist (A10).
        fetch: outbound.fetch,
      },
      ctx: buildContext(snapshot),
      history,
      message,
      cache,
      // Scope the cache to this user's data so answers are never shared.
      cacheScope: {
        userId: tenant.user.id,
        netWorth: snapshot.portfolio.netWorthMinor.toString(),
        cash: snapshot.portfolio.cashMinor.toString(),
        band: snapshot.band,
      },
    });

    return streamSSE(c, async (stream) => {
      let full = '';
      try {
        for await (const delta of textStream) {
          full += delta;
          await stream.writeSSE({ data: JSON.stringify({ delta }) });
        }
      } catch (error) {
        gatewayError = error;
      }

      // A turn that produced no text is a failure, whether or not anything was
      // thrown. This used to be treated as success: the catch was bare, an empty
      // stream fell straight through, and the screen rendered an empty reply
      // bubble with no error and no log — which is what "the agent is not
      // working" looked like from the outside, with nothing on the server to
      // act on. The gateway host and model are recorded because they are the
      // two values most often wrong; the key never is.
      if (full.length === 0) {
        deps.logger.error('agent produced no text', {
          error: gatewayError,
          gateway: deps.config.OPENAI_BASE_URL,
          model: deps.config.AI_MODEL,
          userId: tenant.user.id,
          // No error alongside an empty reply means the request succeeded and
          // the model genuinely returned nothing — a different bug from a
          // gateway that refused the call.
          hadGatewayError: gatewayError !== null,
        });
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'the agent is temporarily unavailable' }),
        });
      } else {
        if (gatewayError !== null) {
          // Partial answer: the stream broke mid-reply. Worth recording even
          // though the user got something, because the something is truncated.
          deps.logger.error('agent stream ended early', {
            error: gatewayError,
            gateway: deps.config.OPENAI_BASE_URL,
            model: deps.config.AI_MODEL,
            userId: tenant.user.id,
            streamedChars: full.length,
          });
        }
        await withTenant(deps, tenant, (tx) =>
          tx.insert(agentMessages).values({ userId: tenant.user.id, role: 'agent', content: full }),
        );
      }
      await stream.writeSSE({ event: 'done', data: '[DONE]' });
    });
  });

  return app;
}
