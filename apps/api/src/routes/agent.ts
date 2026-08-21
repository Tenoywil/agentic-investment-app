import {
  type AgentDisplay,
  type ChatMessage,
  ResponseCache,
  buildContext,
  conversationContext,
  runAgent,
  stripCards,
  stripReasoning,
  turnMemory,
} from '@ccn/agent';
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
 * read/propose-only agent loop runs against the MiniMax gateway; both
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
    // Cleaned on read, not by a migration. Rows written before the reasoning
    // tags were stripped are still in the table, and /agent replays the last 50
    // on every load — so without this the same wall of "let me try funds…"
    // greets the customer forever. Reading is also the only place it can be
    // done safely: agent_messages is append-only to the app role. `stripCards`
    // removes the conversation-memory appendix the same way: those blocks are
    // for the model's history, never for a human surface.
    return c.json({
      messages: rows
        .reverse()
        .map((r) =>
          r.role === 'agent' ? { ...r, content: stripCards(stripReasoning(r.content)) } : r,
        )
        // A card-only turn strips to nothing here (its cards were drawn live
        // and its memory block is model-facing); an empty bubble helps nobody.
        .filter((r) => r.content.length > 0),
    });
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
      // The model's history keeps the `<card>` memory blocks (unlike /history,
      // which strips them): they are the record of what the user was shown,
      // and follow-ups like "propose the second one" resolve against them.
      const rows = await tx
        .select({ role: agentMessages.role, content: agentMessages.content })
        .from(agentMessages)
        .where(eq(agentMessages.userId, tenant.user.id))
        .orderBy(desc(agentMessages.createdAt))
        .limit(100);
      await tx
        .insert(agentMessages)
        .values({ userId: tenant.user.id, role: 'user', content: message });
      const hist = conversationContext(
        rows.reverse().map(
          (r): ChatMessage => ({
            role: r.role === 'agent' ? 'assistant' : 'user',
            content: r.content,
          }),
        ),
      );
      return { snapshot: snap, history: hist };
    });

    // streamText reports a failed request here and then ends the stream
    // normally, so this is the only place the real cause is available.
    let gatewayError: unknown = null;
    /** Structured proposals the model prepared during this turn. */
    const proposals: unknown[] = [];
    /** Structured tool results the client draws as inline cards. */
    const displays: AgentDisplay[] = [];
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
      /**
       * A proposal the model prepared, captured so the screen can offer it as a
       * card. Collected rather than streamed directly because `streamSSE` below
       * owns the connection; it is flushed as its own event once the text is
       * done, which also means a turn that fails mid-answer sends no proposal.
       */
      onProposal: (p) => proposals.push(p),
      /**
       * A tool result the client renders as a visual card — allocation,
       * goals, a comparison, a fit score, the pipeline trace. Buffered like
       * proposals (streamSSE owns the connection) and flushed after the text:
       * the data is the pure context's own computation, so the chart cannot
       * contain a number the model invented.
       */
      onDisplay: (d) => displays.push(d),
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

      // A turn that produced no text AND no cards is a failure, whether or not
      // anything was thrown. This used to be treated as success: the catch was
      // bare, an empty stream fell straight through, and the screen rendered an
      // empty reply bubble with no error and no log — which is what "the agent
      // is not working" looked like from the outside, with nothing on the
      // server to act on. The gateway host and model are recorded because they
      // are the two values most often wrong; the key never is. A card-only
      // turn, by contrast, is a real answer the user saw drawn — it persists
      // below as memory even with no prose around it.
      if (full.length === 0 && displays.length === 0 && proposals.length === 0) {
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
        // Stored clean, plus the turn's conversation memory: a compact record
        // of every card and proposal the user was shown, appended as `<card>`
        // blocks. The model reads them back on later turns (so "the second
        // one" means something); /history strips them before a human sees the
        // message. The reasoning strip is the belt to the middleware's braces —
        // a malformed or truncated block must not become a permanent row.
        await withTenant(deps, tenant, (tx) =>
          tx.insert(agentMessages).values({
            userId: tenant.user.id,
            role: 'agent',
            content: stripCards(stripReasoning(full)) + turnMemory(displays, proposals),
          }),
        );
      }
      /**
       * Anything the model prepared, after the text and before `done`.
       *
       * The client turns each of these into a card with a button that raises a
       * real approval row. The agent cannot raise one itself — its tool set has
       * no state-mutating tool and `assertReadOnly` runs on every turn — so this
       * is a suggestion travelling to a human, which is the whole design.
       */
      for (const proposal of proposals) {
        await stream.writeSSE({ event: 'proposal', data: JSON.stringify(proposal) });
      }
      // Display cards after the text for the same reason as proposals. An
      // older client that doesn't know the event ignores it harmlessly.
      for (const display of displays) {
        await stream.writeSSE({ event: 'display', data: JSON.stringify(display) });
      }

      await stream.writeSSE({ event: 'done', data: '[DONE]' });
    });
  });

  return app;
}
