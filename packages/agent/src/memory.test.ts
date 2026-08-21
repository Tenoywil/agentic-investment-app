import { describe, expect, it } from 'bun:test';
import { cardNote, conversationContext, stripCardStream, stripCards, turnMemory } from './memory';

/**
 * Conversation memory: cards the user saw are appended to the stored turn as
 * `<card>` blocks for the model's history, and stripped before any human
 * surface renders the message. Losing them was why "propose the second one"
 * got a general answer: the comparison the user was pointing at had never
 * entered the record.
 */
describe('turn memory', () => {
  it('serializes displays and proposals as card blocks', () => {
    const memory = turnMemory(
      [{ kind: 'comparison', data: { rows: [{ name: 'GOJ 2032' }, { name: 'REX Fund' }] } }],
      [{ instrumentId: 'i1', amount: 'US$500' }],
    );
    expect(memory).toContain('<card kind="comparison">');
    expect(memory).toContain('GOJ 2032');
    expect(memory).toContain('<card kind="proposal">');
    expect(memory).toContain('"instrumentId":"i1"');
  });

  it('is empty for a prose-only turn', () => {
    expect(turnMemory([], [])).toBe('');
  });

  it('labels truncation instead of cutting silently', () => {
    const big = cardNote({ kind: 'comparison', data: { blob: 'x'.repeat(5000) } });
    expect(big).toContain('[truncated]');
    expect(big.length).toBeLessThan(2000);
  });

  it('stripCards removes the blocks and heals the whitespace', () => {
    const stored = `Here's the comparison you asked for.${turnMemory(
      [{ kind: 'fit', data: { score: 82 } }],
      [],
    )}`;
    expect(stripCards(stored)).toBe("Here's the comparison you asked for.");
  });

  it('a card-only turn strips to nothing', () => {
    expect(stripCards(turnMemory([{ kind: 'pipeline', data: { stages: 3 } }], []))).toBe('');
  });

  it('fails closed for partial card records', () => {
    expect(stripCards('Visible answer.\n<card kind="allocation">{"total":"US$10,000"}')).toBe(
      'Visible answer.',
    );
    expect(stripCards('{"total":"US$10,000"}</card>Visible answer.')).toBe('Visible answer.');
  });

  it('removes card records split across live stream chunks', async () => {
    async function* chunks(): AsyncIterable<string> {
      yield 'Visible answer.\n<ca';
      yield 'rd kind="allocation">{"total":"US$10,000"}';
      yield '</car';
      yield 'd   >Next step.';
    }

    let visible = '';
    for await (const chunk of stripCardStream(chunks())) visible += chunk;

    expect(visible).toBe('Visible answer.\nNext step.');
  });

  it('does not release an unterminated live card record', async () => {
    async function* chunks(): AsyncIterable<string> {
      yield 'Visible answer.<card kind="allocation">';
      yield '{"total":"US$10,000"}';
    }

    let visible = '';
    for await (const chunk of stripCardStream(chunks())) visible += chunk;

    expect(visible).toBe('Visible answer.');
  });

  it('keeps recent turns plus older goals and structured cards', () => {
    const comparisonCard = `Here are two choices.${turnMemory(
      [{ kind: 'comparison', data: { rows: ['Fund A', 'Fund B'] } }],
      [],
    )}`;
    const history = [
      { role: 'user' as const, content: 'I need the money liquid within 18 months.' },
      { role: 'assistant' as const, content: 'Understood.' },
      { role: 'user' as const, content: 'Thanks.' },
      { role: 'assistant' as const, content: 'Any time.' },
      {
        role: 'assistant' as const,
        content: comparisonCard,
      },
      { role: 'user' as const, content: 'What about the second one?' },
      { role: 'assistant' as const, content: 'Fund B has the shorter term.' },
    ];

    const context = conversationContext(history, { recentMessages: 2, maxAnchors: 4 });
    expect(context.map((message) => message.content)).toEqual([
      'I need the money liquid within 18 months.',
      comparisonCard,
      'What about the second one?',
      'Fund B has the shorter term.',
    ]);
  });

  it('spends a hard context budget on the newest messages first', () => {
    const context = conversationContext(
      [
        { role: 'user', content: 'I prefer income.' },
        { role: 'assistant', content: 'x'.repeat(20) },
        { role: 'user', content: 'Actually, I need growth.' },
      ],
      { recentMessages: 3, maxChars: 30 },
    );
    expect(context).toEqual([{ role: 'user', content: 'Actually, I need growth.' }]);
  });
});
