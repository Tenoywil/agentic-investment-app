import type { Transaction } from '@ccn/db';
import { reconciliationItems } from '@ccn/db';
import { parseStatement } from '@ccn/partner-adapters';
import { adapterFor } from './adapters';

/**
 * Statement-ingestion pipeline: pull a partner's statements through the adapter
 * (read scope), parse them into candidate holdings, and land each as a PENDING
 * reconciliation item. Nothing becomes a holding here — the parsed text is DATA
 * awaiting a human match (reconcile_match), which is the prompt-injection
 * firebreak for anything a statement might contain.
 */
export async function pullStatements(
  tx: Transaction,
  input: { userId: string; partnerCode: string; clientRef: string; now: () => number },
): Promise<{ created: number; partnerId: string }> {
  const { adapter, partnerId } = await adapterFor(tx, input.partnerCode, 'read', input.now);
  const statements = adapter.getStatements ? await adapter.getStatements(input.clientRef) : [];

  const values = statements.flatMap((doc) =>
    parseStatement(doc.lines).map((h) => ({
      userId: input.userId,
      partnerId,
      source: 'statement_ingestion',
      storagePath: doc.id,
      raw: { statementId: doc.id, period: doc.period, lines: doc.lines },
      parsed: {
        name: h.name,
        valueMinor: h.valueMinor.toString(),
        currency: h.currency,
        ...(h.returnLabel ? { returnLabel: h.returnLabel } : {}),
      },
      status: 'pending' as const,
    })),
  );

  if (values.length === 0) return { created: 0, partnerId };
  await tx.insert(reconciliationItems).values(values);
  return { created: values.length, partnerId };
}
