import { type ChatMessage, ResponseCache, buildContext, runAgent } from '@ccn/agent';
import { agentMessages } from '@ccn/db';
import { agentMessageSchema } from '@ccn/domain';
import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AppDeps, AppEnv } from '../context';
import { withTenant } from '../context';
import { requireAuth } from '../middleware';
import { loadAgentSnapshot } from '../services/agent-snapshot';

/**
 * The Capital Agent chat. POST /message streams the reply over SSE while the
 * read/propose-only agent loop runs against the Impala/MiniMax gateway; both
 * sides of the turn persist to agent_messages. The agent can only PROPOSE — the
 * Limits Engine and the human approval loop remain the only paths to execution.
 *
 * A process-local response cache reuses answers to identical turns, scoped per
 * user + portfolio fingerprint so answers are never shared across tenants.
 */
export function agentRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const cache = new ResponseCache<string>(256);
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

    const { textStream } = runAgent({
      gateway: {
        baseURL: deps.config.OPENAI_BASE_URL,
        apiKey: deps.config.OPENAI_API_KEY,
        model: deps.config.AI_MODEL,
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
      } catch {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'the agent is temporarily unavailable' }),
        });
      }
      if (full.length > 0) {
        await withTenant(deps, tenant, (tx) =>
          tx.insert(agentMessages).values({ userId: tenant.user.id, role: 'agent', content: full }),
        );
      }
      await stream.writeSSE({ event: 'done', data: '[DONE]' });
    });
  });

  return app;
}
