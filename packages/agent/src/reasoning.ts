/**
 * Strip a reasoning model's private working out of assistant text.
 *
 * `extractReasoningMiddleware` in provider.ts is the real mechanism and it runs
 * on the live stream. This is the second line, and it exists because the first
 * one is not retroactive and not total:
 *
 * - **Rows already written.** A turn that leaked went into `agent_messages` as
 *   assistant content, so it renders on every visit to /agent forever after,
 *   long after the model is fixed. That is what a customer actually saw: several
 *   hundred words of "No bonds returned. Let me try funds… Nothing returned for
 *   income. Let me check what's available" in the reply bubble.
 * - **Malformed output.** The middleware pairs tags. A model that emits a stray
 *   `</think>`, or opens one it never closes, can still put a fragment through.
 *
 * The rules, in order, because they overlap:
 *
 * 1. A complete `<think>…</think>` block is removed with its contents.
 * 2. An unterminated `<think>` removes everything after it — a truncated stream
 *    cut mid-thought, and there is no answer in what follows.
 * 3. A bare closing `</think>` with no opener means the stream began inside the
 *    block, so everything before it goes.
 *
 * Whitespace is then collapsed to at most one blank line, so a removed block
 * does not leave a hole where a paragraph used to be.
 *
 * Deliberately not configurable per provider. Any model whose text contains
 * literal `<think>` tags is emitting reasoning, whoever serves it, and no answer
 * this product wants to show a customer contains that markup for real.
 */

const COMPLETE = /<think\b[^>]*>[\s\S]*?<\/think\s*>/gi;
const UNTERMINATED = /<think\b[^>]*>[\s\S]*$/i;
const ORPHAN_CLOSE = /^[\s\S]*?<\/think\s*>/i;

export function stripReasoning(text: string): string {
  let out = text.replace(COMPLETE, ' ');
  // Order matters: an orphaned close can only be judged once the balanced pairs
  // are gone, or the closing tag of a legitimate pair would swallow the text in
  // front of it.
  if (/<\/think\s*>/i.test(out)) out = out.replace(ORPHAN_CLOSE, ' ');
  out = out.replace(UNTERMINATED, ' ');
  return (
    out
      .replace(/[ \t]+/g, ' ')
      // Spaces around a newline first, or the blank-line rule below never fires:
      // a removed block leaves "\n\n \n\n", where the stray space between the
      // runs stops them reading as consecutive newlines.
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\s+|\s+$/g, '')
  );
}
