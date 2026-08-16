import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { generateStructured } from './structured';

/**
 * The structured-output workaround: results ride a forced tool call (the
 * mechanism the production gateway demonstrably supports) instead of JSON
 * response format (which it has never honored — gateway_agent_runs was empty
 * from launch). What matters: the tool call's validated input IS the result,
 * prose-only answers retry then fail loudly, and the schema still gates.
 */

const schema = z.object({ answer: z.string(), score: z.number() });

type DoGenerate = MockLanguageModelV4['doGenerate'];

const toolCallResult = (input: unknown) =>
  ({
    finishReason: 'tool-calls',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    content: [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'submit_result',
        input: JSON.stringify(input),
      },
    ],
    warnings: [],
  }) as unknown as Awaited<ReturnType<DoGenerate>>;

const proseResult = {
  finishReason: 'stop',
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  content: [{ type: 'text', text: 'I would rather chat about it.' }],
  warnings: [],
} as unknown as Awaited<ReturnType<DoGenerate>>;

describe('generateStructured', () => {
  test('returns the forced tool call input as the typed object', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => toolCallResult({ answer: 'yes', score: 42 }),
    });
    const result = await generateStructured({ model, schema, prompt: 'p' });
    expect(result).toEqual({ answer: 'yes', score: 42 });
  });

  test('a prose-only first answer is retried, then succeeds', async () => {
    let calls = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls += 1;
        return calls === 1 ? proseResult : toolCallResult({ answer: 'ok', score: 1 });
      },
    });
    const result = await generateStructured({ model, schema, prompt: 'p' });
    expect(result.answer).toBe('ok');
    expect(calls).toBe(2);
  });

  test('runs out of retries loudly, never returns a guess', async () => {
    const model = new MockLanguageModelV4({ doGenerate: async () => proseResult });
    await expect(generateStructured({ model, schema, prompt: 'p', retries: 1 })).rejects.toThrow(
      /no structured result/,
    );
  });

  test('schema violations are rejected by the SDK, not passed through', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => toolCallResult({ answer: 'yes', score: 'not-a-number' }),
    });
    await expect(generateStructured({ model, schema, prompt: 'p', retries: 0 })).rejects.toThrow();
  });
});
