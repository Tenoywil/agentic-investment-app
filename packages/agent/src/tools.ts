import { type ToolSet, tool } from 'ai';
import { z } from 'zod';
import type { AgentContext } from './context';

/**
 * The agent's tool set — READ and PROPOSE only. There is intentionally no tool
 * that creates or approves an order, moves cash, or changes limits. This is the
 * structural half of the prompt-injection defense: even a fully hijacked model
 * has no actuator here. `propose_move` returns the Limits Engine's verdict as a
 * candidate; a human tap (or the exec modal) is the only path to execution.
 */

/** Every tool this agent may ever hold. Asserted read-only at startup and in CI. */
export const TOOL_NAMES = [
  'get_portfolio',
  'get_activity',
  'get_limits',
  'get_allocation',
  'get_goals',
  'search_opportunities',
  'score_suitability',
  'score_fit',
  'compare_opportunities',
  'propose_move',
  'run_pipeline',
  'explain',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Verbs that would indicate a state-mutating tool. A tool name matching any of
 *  these must never exist in this package. */
export const MUTATING_VERBS = [
  'create',
  'execute',
  'place',
  'settle',
  'accept',
  'approve',
  'reject',
  'transfer',
  'move_cash',
  'update',
  'delete',
  'set_',
  'write',
  'buy',
  'sell',
  'order',
] as const;

export function buildTools(ctx: AgentContext): ToolSet {
  return {
    get_portfolio: tool({
      description:
        "Get the user's unified portfolio: net worth, cash, and holdings across partners.",
      inputSchema: z.object({}),
      execute: async () => ctx.getPortfolio(),
    }),
    get_activity: tool({
      description:
        "Get the user's own in-flight activity: each of their orders with where it stands and what happens next, anything waiting on their approval, and the status of each institution connection. Use this for questions like 'where is my order', 'has the firm accepted me yet', or 'what's waiting on me'.",
      inputSchema: z.object({}),
      execute: async () => ctx.getActivity(),
    }),
    get_limits: tool({
      description:
        "Get the user's guardrail limits. They classify user-initiated proposals as auto-act, approval required or blocked; auto-act still requires human confirmation before a licensed firm executes.",
      inputSchema: z.object({}),
      execute: async () => ctx.getLimits(),
    }),
    get_allocation: tool({
      description:
        "Get the user's portfolio allocation by asset type (with their band's target mix and the gap against it), by firm, and by currency. The result is shown in chat as a pie chart and a current-versus-target bar graph. Use it for 'how am I invested', 'am I diversified', any request to chart or graph the portfolio, or any question about the right combination of assets. Don't re-list every number; add your judgment.",
      inputSchema: z.object({}),
      execute: async () => ctx.getAllocation(),
    }),
    get_goals: tool({
      description:
        "Get the user's goals: what each is for, how funded it is, and its horizon. The result is shown in chat as progress bar graphs. Use it for 'am I on track' questions and any request to chart or graph goal progress. Don't re-list every number; add your judgment.",
      inputSchema: z.object({}),
      execute: async () => ctx.getGoals(),
    }),
    search_opportunities: tool({
      description:
        "Search the regional marketplace, filtered by the user's suitability. Optional free-text query, instrument type, and a maximum risk. Screened-out instruments are flagged, not hidden.",
      inputSchema: z.object({
        query: z.string().max(120).optional(),
        type: z.enum(['bond', 'fund', 'equity', 'real_estate', 'private']).optional(),
        maxRisk: z.enum(['low', 'medium', 'high']).optional(),
      }),
      execute: async (input) => ctx.searchOpportunities(input),
    }),
    score_suitability: tool({
      description: "Check whether a specific instrument fits the user's suitability band.",
      inputSchema: z.object({ instrumentId: z.string() }),
      execute: async (input) => ctx.scoreSuitability(input),
    }),
    score_fit: tool({
      description:
        "Weigh one instrument against the user's own portfolio and goals: a 0-100 fit score with the reasons and concerns behind it (duplication, concentration, currency, goal liquidity, target-mix gap). The result is shown to the user as a card.",
      inputSchema: z.object({ instrumentId: z.string() }),
      execute: async (input) => ctx.scoreFit(input),
    }),
    compare_opportunities: tool({
      description:
        'Compare 2-4 instruments side by side: type, region, risk, headline metric, minimum, executing firm, regulator, suitability, and each one’s portfolio-fit score. The result is shown to the user as a comparison table — use it whenever the user weighs options against each other.',
      inputSchema: z.object({ instrumentIds: z.array(z.string()).min(2).max(4) }),
      execute: async (input) => ctx.compareOpportunities(input),
    }),
    propose_move: tool({
      description:
        'PROPOSE an investment of a given amount into an instrument. Runs the deterministic Limits Engine and the same compliance-readiness check as the full pipeline, then returns the verdict with reasons. This PREPARES a proposal only — it never creates or executes an order.',
      inputSchema: z.object({
        instrumentId: z.string(),
        amountMinor: z.number().int().positive().describe('amount in minor units (cents)'),
      }),
      execute: async (input) => ctx.proposeMove(input),
    }),
    run_pipeline: tool({
      description:
        'Run the full five-specialist pipeline — research ranks the live marketplace, portfolio fit weighs holdings and goals, suitability applies the deterministic Limits Engine, compliance checks recorded onboarding readiness and the executing-firm relationship, and coordination sizes the best cleared fit and routes it for approval. The licensed firm retains the final KYC and AML decision. Returns the visible stage-by-stage trace plus the chosen candidate (or none) and a qualitative diaspora comparison against like-for-like US, Canadian or UK alternatives. Use this when the user asks what they should invest in, or asks you to look for something for them. Narrate the stages and comparison faithfully; never invent a stage outcome, benchmark, tax advantage or liquidity claim.',
      inputSchema: z.object({}),
      execute: async () => ctx.scoutMarketplace(),
    }),
    explain: tool({
      description:
        'Explain how CCN works — safety/custody, fees, KYC, how the agent works, or the limits.',
      inputSchema: z.object({ topic: z.enum(['safety', 'fees', 'kyc', 'how_it_works', 'limits']) }),
      execute: async (input) => ctx.explain(input),
    }),
  };
}

/**
 * Fail loudly if a state-mutating tool ever appears in the set. Called at server
 * startup and asserted in the agent-eval suite so a future tool that could move
 * money cannot ship silently.
 */
export function assertReadOnly(tools: ToolSet): void {
  for (const name of Object.keys(tools)) {
    const lower = name.toLowerCase();
    if (MUTATING_VERBS.some((verb) => lower.includes(verb))) {
      throw new Error(
        `agent tool "${name}" looks state-mutating; the agent tool set must be read/propose-only`,
      );
    }
    if (!(TOOL_NAMES as readonly string[]).includes(name)) {
      throw new Error(`agent tool "${name}" is not in the allowlisted TOOL_NAMES`);
    }
  }
}
