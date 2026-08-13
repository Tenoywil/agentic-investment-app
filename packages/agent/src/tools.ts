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
  'get_limits',
  'search_opportunities',
  'score_suitability',
  'propose_move',
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
    get_limits: tool({
      description: "Get the user's guardrail limits (what the agent may do alone).",
      inputSchema: z.object({}),
      execute: async () => ctx.getLimits(),
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
    propose_move: tool({
      description:
        'PROPOSE an investment of a given amount into an instrument. Runs the deterministic Limits Engine and returns its verdict (auto-act / requires approval / blocked) with reasons. This PREPARES a proposal only — it never creates or executes an order.',
      inputSchema: z.object({
        instrumentId: z.string(),
        amountMinor: z.number().int().positive().describe('amount in minor units (cents)'),
      }),
      execute: async (input) => ctx.proposeMove(input),
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
