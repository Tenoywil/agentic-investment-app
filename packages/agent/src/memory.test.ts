import { describe, expect, it } from 'bun:test';
import { cardNote, stripCards, turnMemory } from './memory';

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
});
