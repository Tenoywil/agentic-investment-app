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
const CARD_UNTERMINATED = /<card\b[^>]*>[\s\S]*$/i;
const CARD_ORPHAN_CLOSE = /^[\s\S]*?<\/card\s*>/i;
const CARD_STREAM_OPEN = /<card\b/i;
const CARD_STREAM_CLOSE = /<\/card\s*>/i;
const CARD_STREAM_CLOSE_TAIL = /(?:<|<\/|<\/c|<\/ca|<\/car|<\/card\s*)$/i;

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
  let out = text.replace(CARD_BLOCK, ' ');
  // Once balanced blocks are gone, a remaining close means the text began in
  // a machine record; an opener without a close means the response ended in
  // one. Fail closed in both cases instead of showing partial JSON to a user.
  if (/<\/card\s*>/i.test(out)) out = out.replace(CARD_ORPHAN_CLOSE, ' ');
  out = out.replace(CARD_UNTERMINATED, ' ');
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

/**
 * Remove model-emitted `<card>` records while preserving a live text stream.
 *
 * Card records belong only in model-facing conversation memory. Prompt rules
 * are not a security boundary, so a model can still echo one, and chunking can
 * split either tag at any character. Keep the shortest possible suffix while
 * looking for an opener, then suppress everything through its closing tag. An
 * unterminated record is discarded at EOF rather than exposed as partial JSON.
 */
export async function* stripCardStream(source: AsyncIterable<string>): AsyncIterable<string> {
  let buffer = '';
  let insideCard = false;
  const openerTailLength = '<card'.length - 1;

  for await (const chunk of source) {
    if (chunk.length === 0) continue;
    buffer += chunk;

    while (buffer.length > 0) {
      if (insideCard) {
        const close = CARD_STREAM_CLOSE.exec(buffer);
        if (!close) {
          // Discard card data as it arrives. Retain only a suffix that could be
          // the beginning of a closing tag, keeping malformed output bounded.
          buffer = CARD_STREAM_CLOSE_TAIL.exec(buffer)?.[0] ?? '';
          break;
        }
        buffer = buffer.slice(close.index + close[0].length);
        insideCard = false;
        continue;
      }

      const open = CARD_STREAM_OPEN.exec(buffer);
      if (open) {
        const visible = buffer.slice(0, open.index);
        if (visible.length > 0) yield visible;
        buffer = buffer.slice(open.index + open[0].length);
        insideCard = true;
        continue;
      }

      const emitLength = buffer.length - openerTailLength;
      if (emitLength <= 0) break;
      yield buffer.slice(0, emitLength);
      buffer = buffer.slice(emitLength);
    }
  }

  if (!insideCard && buffer.length > 0) yield buffer;
}
