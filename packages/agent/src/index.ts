/**
 * @ccn/agent — the AI Capital Agent: a read/propose-only tool loop over the
 * OpenAI gateway. The model proposes; the deterministic Limits Engine and
 * the human approval loop are the only paths to execution. The security-critical
 * logic (tools, context, prompt discipline, cache) is pure and unit-tested; the
 * gateway call is a thin adapter (run.ts).
 */
export * from './snapshot';
export * from './context';
export * from './prompt';
export * from './tools';
export * from './cache';
export * from './provider';
export * from './run';
export * from './gateway/matching';
export * from './gateway/readiness';
export * from './gateway/provider';
export * from './gateway/orchestrator';
