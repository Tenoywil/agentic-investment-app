import { describe, expect, test } from 'bun:test';
import { stripReasoning } from './reasoning';

/**
 * The fixture is the real thing. A customer opened /agent on production, asked
 * for the best income deal, and got the model's private working in the reply
 * bubble — several hundred words of dead ends, in a product that claims a
 * licensed, suitability-aware agent is answering.
 */
const LEAKED =
  '<think> The user is asking for the best income deal. I should search for income-generating opportunities that match their suitability profile. Let me search for fixed income instruments - bonds and funds that provide income. </think> <think> No bonds returned. Let me try funds - maybe income funds or money market funds. </think> <think> No funds either. Let me try without specifying type, just searching for income. </think>';

describe('stripReasoning', () => {
  test('removes the reasoning a customer actually saw, leaving nothing behind', () => {
    expect(stripReasoning(LEAKED)).toBe('');
  });

  test('keeps the answer and drops the working around it', () => {
    const text =
      '<think>Let me check their limits first.</think>Your USD cash is idle. The NCB USD Money Market Fund offers same-day access.';
    expect(stripReasoning(text)).toBe(
      'Your USD cash is idle. The NCB USD Money Market Fund offers same-day access.',
    );
  });

  test('handles several blocks interleaved with answer text', () => {
    const text = '<think>a</think>First point.<think>b</think>Second point.';
    expect(stripReasoning(text)).toBe('First point. Second point.');
  });

  /**
   * A stream cut mid-thought. There is no answer after an opener that never
   * closes, so everything following it goes — keeping it would print a
   * half-finished thought as though it were advice.
   */
  test('drops an unterminated block and everything after it', () => {
    expect(stripReasoning('Here is the summary.<think>Now let me check whether')).toBe(
      'Here is the summary.',
    );
  });

  /**
   * The mirror image: the stream began inside the block, so the close tag is the
   * first thing seen and everything before it is working, not answer.
   */
  test('drops an orphaned closing tag and everything before it', () => {
    expect(stripReasoning('checking the limits table</think>Your cap is 25%.')).toBe(
      'Your cap is 25%.',
    );
  });

  test('leaves ordinary text untouched, including its paragraphs', () => {
    const text = 'Line one.\n\nLine two.';
    expect(stripReasoning(text)).toBe(text);
  });

  test('matches the tag whatever case or attributes it carries', () => {
    expect(stripReasoning('<THINK>x</THINK>ok')).toBe('ok');
    expect(stripReasoning('<think type="reasoning">x</think >ok')).toBe('ok');
  });

  /**
   * A removed block must not leave the hole it came out of. Three blank lines
   * where a paragraph used to be reads as a rendering fault.
   */
  test('collapses the gap a removed block leaves', () => {
    expect(stripReasoning('One.\n\n<think>x</think>\n\n\n\nTwo.')).toBe('One.\n\nTwo.');
  });

  test('is a no-op on an empty string', () => {
    expect(stripReasoning('')).toBe('');
  });
});
