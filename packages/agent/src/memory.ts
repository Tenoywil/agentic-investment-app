import type { AgentDisplay, ChatMessage } from './run';

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

const CONTEXT_ANCHOR =
  /\b(?:actually|avoid|budget|cash floor|currency|do not|don't|goal|horizon|income|instead|liquid|liquidity|limit|must|need|never|only|prefer|preference|retire|retirement|risk|sector|timeline|timeframe|want)\b|\b\d+\s*(?:years?|months?)\b|\b(?:US|J|Bds)\$\s?[\d,]+/i;

export interface ConversationContextOptions {
  /** Recent messages retained regardless of whether they contain a keyword. */
  recentMessages?: number;
  /** Older high-signal messages retained before the recent window. */
  maxAnchors?: number;
  /** Hard character ceiling for the model-facing conversation history. */
  maxChars?: number;
}

/**
 * Keep a bounded but useful model history.
 *
 * The newest turns remain the source of truth for what pronouns and short
 * answers refer to. Older small talk can fall away, while explicit goals,
 * constraints, corrections and structured card records survive as anchors.
 * This is extraction, not model summarization: no fact is rewritten or
 * promoted into a system instruction.
 */
export function conversationContext(
  history: ChatMessage[],
  options: ConversationContextOptions = {},
): ChatMessage[] {
  const recentMessages = Math.max(1, options.recentMessages ?? 30);
  const maxAnchors = Math.max(0, options.maxAnchors ?? 12);
  const maxChars = Math.max(1, options.maxChars ?? 60_000);
  const cleaned = history
    .map((message) => ({ ...message, content: message.content.trim() }))
    .filter((message) => message.content.length > 0);
  const recentStart = Math.max(0, cleaned.length - recentMessages);
  const selected = new Set<number>();

  for (let i = recentStart; i < cleaned.length; i += 1) selected.add(i);

  let anchors = 0;
  for (let i = recentStart - 1; i >= 0 && anchors < maxAnchors; i -= 1) {
    const message = cleaned[i];
    if (!message) continue;
    const isStructuredRecord = message.role === 'assistant' && /<card\b/i.test(message.content);
    const isUserIntent = message.role === 'user' && CONTEXT_ANCHOR.test(message.content);
    if (!isStructuredRecord && !isUserIntent) continue;
    selected.add(i);
    anchors += 1;
  }

  // Spend the budget from newest to oldest. Recent corrections therefore win
  // over stale preferences when an unusually long conversation reaches the cap.
  let used = 0;
  const kept: number[] = [];
  for (const index of [...selected].sort((a, b) => b - a)) {
    const size = cleaned[index]?.content.length ?? 0;
    if (used + size > maxChars) continue;
    kept.push(index);
    used += size;
  }

  return kept.sort((a, b) => a - b).map((index) => cleaned[index] as ChatMessage);
}

/** Remove `<card>` appendix blocks before text reaches a human surface. */
export function stripCards(text: string): string {
  return text
    .replace(CARD_BLOCK, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}
