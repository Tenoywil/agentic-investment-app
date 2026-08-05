import { z } from 'zod';

/**
 * Zod schemas for API request boundaries (the customer app and partner console).
 * Everything crossing the wire is parsed here before it reaches a handler — an
 * invalid body never touches the database or the Limits Engine.
 */

export const currencySchema = z.enum(['USD', 'JMD', 'TTD']);

/**
 * Minor units off the wire: a non-negative integer sent as a JSON number or a
 * digit string (bigint has no JSON form), normalized to `bigint`. Rejects
 * floats, signs, and non-numeric strings.
 */
export const amountMinorSchema = z
  .union([
    z.number().int().nonnegative(),
    z.string().regex(/^\d+$/, 'must be a non-negative integer'),
  ])
  .transform((v) => BigInt(v));

export const positiveAmountMinorSchema = amountMinorSchema.refine((v) => v > 0n, {
  message: 'amount must be greater than zero',
});

export const uuidSchema = z.string().uuid();

/** POST /api/orders — propose an investment; the engine decides its fate. */
export const proposeOrderSchema = z.object({
  instrumentId: uuidSchema,
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema.default('USD'),
  // Optional client idempotency key; the server derives one when absent.
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type ProposeOrderInput = z.infer<typeof proposeOrderSchema>;

/** POST /api/approvals — the agent (or a test) opens a "Needs your approval"
 *  card. Approving it later is one of only two paths to an order. */
export const createApprovalSchema = z.object({
  instrumentId: uuidSchema,
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema.default('USD'),
  type: z.enum(['investment_rec', 'fund_transfer', 'plan_enrollment']).default('investment_rec'),
  title: z.string().min(1).max(200),
  body: z.string().max(1000).optional(),
});
export type CreateApprovalInput = z.infer<typeof createApprovalSchema>;

/** POST /api/approvals/:id/approve — optional client idempotency key. */
export const approveSchema = z.object({
  idempotencyKey: z.string().min(8).max(200).optional(),
});
export type ApproveInput = z.infer<typeof approveSchema>;

/** POST /api/agent/message — a chat turn to the Capital Agent. */
export const agentMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});
export type AgentMessageInput = z.infer<typeof agentMessageSchema>;

/** POST /api/approvals/:id/reject and console reject — optional reason. */
export const rejectSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type RejectInput = z.infer<typeof rejectSchema>;
