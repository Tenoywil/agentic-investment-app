import type { AgentDisplay } from './run';

/**
 * Conversation memory for the turns the user experienced as pictures.
 *
 * Half the agent's best answers are visual cards, not prose: the comparison
 * table, the fit score, the pipeline trace. The prompt tells the model NOT to
 * re-list a card's numbers in text, and only the text was persisted, so the
 * conversation's own record was missing exactly the content follow-ups refer
 * to. "Propose the second one" arrived at a model whose history contained the
 * sentence around a table it could no longer see, and the reply came back
 * general and wrong.
 *
 * The fix is an appendix: each card (and each prepared proposal) is serialized
 * into a compact `<card>` block appended to the stored assistant message.
 * The model sees these blocks in its history and can resolve references
 * against them; `stripCards` removes them before any human-facing surface
 * renders the message, the same read-time discipline `stripReasoning` uses
 * for leaked chain-of-thought.
 */

/** Cap per card so a big comparison cannot bloat the history the model reads. */
const CARD_JSON_LIMIT = 1500;

function compact(data: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(data) ?? 'null';
  } catch {
    return '"[unserializable]"';
  }
  if (json.length <= CARD_JSON_LIMIT) return json;
  // Truncation is labeled, never silent — the model should know the record is
  // partial rather than treat a cut-off number as a whole one.
  return `${JSON.stringify(`${json.slice(0, CARD_JSON_LIMIT)}… [truncated]`)}`;
}

/** One display card as a history appendix block. */
export function cardNote(display: AgentDisplay): string {
  return `<card kind="${display.kind}">${compact(display.data)}</card>`;
}

/** One prepared proposal as a history appendix block. */
export function proposalNote(proposal: unknown): string {
  return `<card kind="proposal">${compact(proposal)}</card>`;
}

/**
 * The appendix for one finished turn: every card and proposal the user was
 * shown, in order, or an empty string when the turn was prose only.
 */
export function turnMemory(displays: AgentDisplay[], proposals: unknown[]): string {
  const blocks = [...displays.map(cardNote), ...proposals.map(proposalNote)];
  return blocks.length === 0 ? '' : `\n\n${blocks.join('\n')}`;
}

const CARD_BLOCK = /<card\b[^>]*>[\s\S]*?<\/card\s*>/gi;

/** Remove `<card>` appendix blocks before text reaches a human surface. */
export function stripCards(text: string): string {
  return text
    .replace(CARD_BLOCK, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}
