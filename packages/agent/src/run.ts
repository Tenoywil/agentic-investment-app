import { type ModelMessage, stepCountIs, streamText } from 'ai';
import { ResponseCache } from './cache';
import type { AgentContext } from './context';
import { SYSTEM_PROMPT } from './prompt';
import { type GatewayConfig, createGatewayModel } from './provider';
import { assertReadOnly, buildTools } from './tools';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface RunAgentArgs {
  gateway: GatewayConfig;
  ctx: AgentContext;
  /** Prior turns, oldest first. */
  history: ChatMessage[];
  /** The new user message (already untrusted-wrapped by the caller if needed). */
  message: string;
  system?: string;
  cache?: ResponseCache<string>;
  /**
   * Extra key material folded into the cache key so answers are never shared
   * across users. The tools read the caller's own data, so the cache MUST be
   * scoped to it — pass a per-user, per-snapshot fingerprint here.
   */
  cacheScope?: unknown;
  /** Max tool-use steps before the model must answer. */
  maxSteps?: number;
  /**
   * Called when the underlying model call fails.
   *
   * `streamText` does NOT throw on a failed request — it reports the error here
   * and ends the stream normally. Consume only `textStream` and a gateway that
   * is unreachable, unauthorized or rate-limited is indistinguishable from a
   * model that chose to say nothing: zero chunks, no exception, no clue. That
   * is precisely how a broken agent reached production looking like an empty
   * reply bubble, so the hook is part of the contract rather than an extra.
   */
  onError?: (error: unknown) => void;
  /**
   * Called when the model runs `propose_move` and the Limits Engine returns a
   * verdict.
   *
   * The tool set is read/propose-only by construction — there is deliberately no
   * tool that creates an order, an approval, or moves cash — so a proposal has
   * always existed only inside the model's own reasoning and reached the user as
   * prose. That left the product's headline loop unreachable: nothing in the
   * app called POST /api/approvals, and the only writer of an approval row was
   * the demo seed, so "the agent proposes and you approve" could not happen for
   * anyone outside an email allowlist.
   *
   * Surfacing the verdict is not the same as acting on it. This hands the
   * caller a structured proposal to show; a human still has to raise the
   * approval card, and a second human tap still has to approve it. The model
   * gains no actuator it did not have.
   */
  onProposal?: (proposal: unknown) => void;
}

export interface RunAgentResult {
  /** The reply text, streamed. */
  textStream: AsyncIterable<string>;
  /** True when served from the response cache (no gateway call was made). */
  cached: boolean;
}

async function* once(text: string): AsyncIterable<string> {
  yield text;
}

async function* teeIntoCache(
  source: AsyncIterable<string>,
  cache: ResponseCache<string>,
  key: string,
): AsyncIterable<string> {
  let full = '';
  for await (const chunk of source) {
    full += chunk;
    yield chunk;
  }
  if (full.length > 0) cache.set(key, full);
}

/**
 * Run one agent turn. The tool set is asserted read/propose-only first (defense
 * in depth), then the model streams a reply, calling only those tools. Identical
 * turns (same system + history + message) are served from the response cache
 * without touching the gateway.
 *
 * The LLM is confined to this adapter; all decision logic lives in the pure tools
 * and the Limits Engine, which is why the eval suite can cover behavior without a
 * live model.
 */
export function runAgent(args: RunAgentArgs): RunAgentResult {
  const system = args.system ?? SYSTEM_PROMPT;
  const tools = buildTools(args.ctx);
  assertReadOnly(tools);

  const key = ResponseCache.key({
    system,
    history: args.history,
    message: args.message,
    scope: args.cacheScope ?? null,
  });
  if (args.cache?.has(key)) {
    return { textStream: once(args.cache.get(key) ?? ''), cached: true };
  }

  const messages: ModelMessage[] = [
    ...args.history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    { role: 'user', content: args.message },
  ];

  const result = streamText({
    model: createGatewayModel(args.gateway),
    system,
    messages,
    tools,
    stopWhen: stepCountIs(args.maxSteps ?? 8),
    onError: ({ error }) => args.onError?.(error),
    onStepFinish: ({ toolResults }) => {
      if (!args.onProposal) return;
      for (const r of toolResults) {
        if (r.toolName === 'propose_move') args.onProposal(r.output);
      }
    },
  });

  const textStream = args.cache
    ? teeIntoCache(result.textStream, args.cache, key)
    : result.textStream;
  return { textStream, cached: false };
}
