import { withRls } from '@ccn/db';
import { valueSnapshots } from '@ccn/db';
import { sql } from 'drizzle-orm';
import type { AppDeps } from '../context';

/**
 * The valuation recorder's clock. Once a day, `record_value_snapshots()`
 * (0031, SECURITY DEFINER) writes one row per investor and one per firm from
 * the holdings that exist right now — the raw material of every "is this
 * making a difference?" chart. The function is idempotent per day, so the
 * hourly check costs one SELECT on the hours nothing needs doing, and a
 * restarted API catches up instead of skipping the day.
 *
 * Started only from the composition root, like the agent sweep, and disabled
 * by the same switch (AGENT_SWEEP_INTERVAL_MS=0): one kill switch for all
 * background work, documented in packages/config.
 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export async function recordValueSnapshotsIfDue(
  deps: Pick<AppDeps, 'db' | 'config' | 'logger'>,
): Promise<boolean> {
  const dbRole = deps.config.DB_APP_ROLE;
  return withRls(deps.db, { appRole: 'admin', dbRole }, async (tx) => {
    const [latest] = await tx
      .select({ takenOn: valueSnapshots.takenOn })
      .from(valueSnapshots)
      .orderBy(sql`${valueSnapshots.takenOn} desc`)
      .limit(1);
    const today = new Date().toISOString().slice(0, 10);
    if (latest?.takenOn === today) return false;

    const rows = (await tx.execute(sql`select record_value_snapshots() as n`)) as unknown as {
      n: number;
    }[];
    deps.logger.info('value snapshots recorded', { day: today, rows: rows[0]?.n ?? 0 });
    return true;
  });
}

export function startValueSnapshots(deps: Pick<AppDeps, 'db' | 'config' | 'logger'>): () => void {
  if (deps.config.AGENT_SWEEP_INTERVAL_MS <= 0) {
    deps.logger.info('value snapshot recorder disabled (AGENT_SWEEP_INTERVAL_MS=0)');
    return () => {};
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await recordValueSnapshotsIfDue(deps);
    } catch (error) {
      deps.logger.error('value snapshot recording failed', { error });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, 20_000);
  const timer = setInterval(tick, CHECK_INTERVAL_MS);
  deps.logger.info('value snapshot recorder started', { checkIntervalMs: CHECK_INTERVAL_MS });
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
