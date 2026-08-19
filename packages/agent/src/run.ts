import { type LanguageModel, type ModelMessage, stepCountIs, streamText } from 'ai';
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
  /** Production gateway configuration. Required unless a model is injected. */
  gateway?: GatewayConfig;
  /**
   * Injectable model seam for deterministic tests and alternate runtimes.
   * Production omits this and receives the SSRF-guarded gateway model below.
   */
  model?: LanguageModel;
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
  /**
   * Called when the model runs a tool whose result the client renders as a
   * visual card (allocation chart, goal rings, comparison table, fit score,
   * the pipeline trace). The payload is the tool's own typed output plus its
   * kind — data the pure context computed, never model prose — so the chart
   * the user sees cannot contain a number the model invented. Purely a
   * display channel: nothing here proposes or acts.
   */
  onDisplay?: (display: AgentDisplay) => void;
}

/** Tool results the client renders as inline cards, tagged by kind. */
export type AgentDisplayKind = 'allocation' | 'goals' | 'comparison' | 'fit' | 'pipeline';
export interface AgentDisplay {
  kind: AgentDisplayKind;
  data: unknown;
}

/** Which tools feed the display channel, and the kind each renders as. */
const DISPLAY_TOOLS: Record<string, AgentDisplayKind> = {
  get_allocation: 'allocation',
  get_goals: 'goals',
  compare_opportunities: 'comparison',
  score_fit: 'fit',
  run_pipeline: 'pipeline',
};

export type VisualToolName = 'get_allocation' | 'get_goals';

/**
 * Route current-account views and explicit visual requests to the read-only
 * tool that owns the facts. This is intentionally narrow: a request for an
 * unspecified "chart" still needs one short clarification, while "what am I
 * invested in?", portfolio pies/bars and goal progress have an unambiguous
 * source. The forced tool runs only on step zero; the model then receives its
 * result and remains free to explain it normally.
 */
export function visualToolForRequest(message: string): VisualToolName | null {
  const asksForVisual =
    /\b(?:bar(?:\s+graph)?|chart|donut|graph|pie|plot|visuali[sz](?:e|ation))\b/i;
  const visual = asksForVisual.test(message);

  if (
    /\b(?:am i on[ -]track|goal progress|how (?:close|funded) (?:am i|are my goals)|my goals?)\b/i.test(
      message,
    ) ||
    (visual && /\b(?:goal|goals|funded|funding|on[ -]track|target progress)\b/i.test(message))
  ) {
    return 'get_goals';
  }
  if (
    /\b(?:am i diversified|how am i invested|my allocation|my asset mix|my holdings|my portfolio|what am i invested in)\b/i.test(
      message,
    ) ||
    (visual &&
      /\b(?:allocation|asset mix|diversif(?:y|ied|ication)|holding|holdings|invested|portfolio)\b/i.test(
        message,
      )) ||
    (visual && /\b(?:donut|pie)\b/i.test(message))
  ) {
    return 'get_allocation';
  }
  return null;
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
  const visualTool = visualToolForRequest(args.message);
  // A chart request must execute the data tool on this turn. Replaying a
  // text-only cache entry would reproduce the exact defect this route fixes.
  const cache = visualTool === null ? args.cache : undefined;

  const key = ResponseCache.key({
    system,
    history: args.history,
    message: args.message,
    scope: args.cacheScope ?? null,
  });
  if (cache?.has(key)) {
    return { textStream: once(cache.get(key) ?? ''), cached: true };
  }

  const messages: ModelMessage[] = [
    ...args.history.map((m) => ({ role: m.role, content: m.content }) as ModelMessage),
    { role: 'user', content: args.message },
  ];

  const model = args.model ?? (args.gateway ? createGatewayModel(args.gateway) : null);
  if (!model) throw new Error('runAgent requires either a gateway configuration or a model');

  const result = streamText({
    model,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(args.maxSteps ?? 8),
    ...(visualTool === null
      ? {}
      : {
          prepareStep: ({ stepNumber }: { stepNumber: number }) =>
            stepNumber === 0
              ? {
                  activeTools: [visualTool],
                  toolChoice: { type: 'tool' as const, toolName: visualTool },
                }
              : undefined,
        }),
    onError: ({ error }) => args.onError?.(error),
    onStepFinish: ({ toolResults }) => {
      for (const r of toolResults) {
        if (r.toolName === 'propose_move') args.onProposal?.(r.output);
        const kind = DISPLAY_TOOLS[r.toolName];
        if (kind) args.onDisplay?.({ kind, data: r.output });
      }
    },
  });

  const textStream = cache ? teeIntoCache(result.textStream, cache, key) : result.textStream;
  return { textStream, cached: false };
}
