import { type LanguageModel, generateText, tool } from 'ai';
import type { z } from 'zod';

/**
 * Structured output over a gateway that has never honored JSON response
 * format.
 *
 * Every schema-constrained pass in this package used `generateObject`, which
 * on an OpenAI-compatible provider without `supportsStructuredOutputs` sends
 * `response_format: {type: "json_object"}`. The MiniMax gateway serving
 * production has never once completed such a call — `gateway_agent_runs` was
 * empty from the day the Gateway shipped — while the chat's TOOL CALLS work
 * on the very same gateway, model and middleware every day.
 *
 * So structure rides on the mechanism the provider demonstrably supports:
 * one forced tool call whose input schema IS the output schema. The SDK
 * validates the arguments against the Zod schema exactly as it does for real
 * tools, so the caller still gets a typed, validated object or a thrown
 * error — never a guess. One retry, because a model occasionally answers in
 * prose before complying.
 */

const RESULT_TOOL = 'submit_result';

export interface GenerateStructuredArgs<SCHEMA extends z.ZodType> {
  model: LanguageModel;
  schema: SCHEMA;
  prompt: string;
  /** Extra attempts after the first failure. */
  retries?: number;
}

export async function generateStructured<SCHEMA extends z.ZodType>(
  args: GenerateStructuredArgs<SCHEMA>,
): Promise<z.infer<SCHEMA>> {
  const attempts = 1 + (args.retries ?? 1);
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await generateText({
        model: args.model,
        prompt: args.prompt,
        tools: {
          [RESULT_TOOL]: tool({
            description:
              'Submit the structured result. Call this exactly once with the complete answer.',
            inputSchema: args.schema,
          }),
        },
        toolChoice: { type: 'tool', toolName: RESULT_TOOL },
      });
      const call = result.toolCalls.find((c) => c.toolName === RESULT_TOOL);
      if (!call) throw new Error('the model returned no structured result call');
      // Validated HERE, not trusted from the SDK: the tool-call layer's own
      // validation behavior has varied across ai versions, and a schema this
      // function promised is a schema this function checks.
      const parsed = args.schema.safeParse(call.input);
      if (!parsed.success) {
        throw new Error(`structured result failed validation: ${parsed.error.message}`);
      }
      return parsed.data as z.infer<SCHEMA>;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`structured generation failed: ${String(lastError)}`);
}
