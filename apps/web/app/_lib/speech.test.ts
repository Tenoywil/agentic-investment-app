import { describe, expect, test } from 'bun:test';
import { collapseTranscripts } from './speech';

/**
 * The wall-of-repeated-words bug: Android Chrome's recogniser reports the
 * GROWING PHRASE as successive results — "how", "how can", "how can I find" —
 * and appending them stacked every prefix into the spoken question. Desktop
 * Chrome reports genuine segments that must all survive. One collapse serves
 * both.
 */
describe('collapseTranscripts', () => {
  test('growing Android prefixes collapse to the final phrase', () => {
    expect(
      collapseTranscripts([
        'how',
        'how can',
        'how can I',
        'how can I find',
        'how can I find in my account',
        'how can I find in my account so I can start investing more',
      ]),
    ).toBe('how can I find in my account so I can start investing more');
  });

  test('desktop segments that do not prefix each other all survive, in order', () => {
    expect(collapseTranscripts(['find me a bond', 'under five hundred dollars'])).toBe(
      'find me a bond under five hundred dollars',
    );
  });

  test('mixed: a phrase that grows, then a new segment', () => {
    expect(collapseTranscripts(['what am', 'what am I invested in', 'and my cash balance'])).toBe(
      'what am I invested in and my cash balance',
    );
  });

  test('case drift between ticks still collapses', () => {
    expect(collapseTranscripts(['How can', 'how can I withdraw'])).toBe('how can I withdraw');
  });

  test('empty and whitespace-only parts drop out', () => {
    expect(collapseTranscripts(['', '  ', 'hello', ''])).toBe('hello');
    expect(collapseTranscripts([])).toBe('');
  });
});
