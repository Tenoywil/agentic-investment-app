import { describe, expect, it } from 'bun:test';
import { chunkForSpeech } from '../app/_lib/speech';

/**
 * The spoken reply was being cut off part-way through.
 *
 * Chromium stops speaking a long utterance after roughly fifteen seconds. It is
 * a watchdog inside the engine rather than an error, so nothing fires
 * `onerror`: the voice just stops mid-sentence and the rest of the answer is
 * never spoken. An agent's answer runs well past fifteen seconds, so this hit
 * essentially every reply.
 *
 * The fix is to queue short utterances instead of one long one. What has to
 * hold for that to be an improvement rather than a different bug: every chunk
 * short enough to finish, no word lost at a boundary, and the pieces
 * reassembling into exactly what the agent said.
 */

const BUDGET = 180;

/** What the listener actually hears, in order. */
const spoken = (chunks: string[]) => chunks.join(' ').replace(/\s+/g, ' ').trim();
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();

const LONG_REPLY = [
  'A money market fund is a pooled fund that holds short-term debt — treasury bills, bank deposits, commercial paper.',
  'It aims to keep your capital stable and pay a modest yield, so people use it for money they may want back soon.',
  'It is not a savings account and it is not guaranteed, though the risk is at the low end of what is on this network.',
  'Yours would be executed by the licensed firm that lists it, not by CCN; we route the instruction and they custody the money.',
  'If you want, I can check what a specific amount would be decided as against your own limits before anything is prepared.',
].join(' ');

describe('chunkForSpeech', () => {
  it('keeps every chunk inside the budget', () => {
    for (const chunk of chunkForSpeech(LONG_REPLY, BUDGET)) {
      expect(chunk.length).toBeLessThanOrEqual(BUDGET);
    }
  });

  it('loses no words at the boundaries', () => {
    expect(spoken(chunkForSpeech(LONG_REPLY, BUDGET))).toBe(normalise(LONG_REPLY));
  });

  it('breaks a long reply into more than one utterance', () => {
    // The whole point: one utterance is what the engine cuts off.
    expect(chunkForSpeech(LONG_REPLY, BUDGET).length).toBeGreaterThan(1);
  });

  it('leaves a short reply as a single utterance', () => {
    const short = 'Nothing is waiting on you right now.';
    expect(chunkForSpeech(short, BUDGET)).toEqual([short]);
  });

  it('splits a sentence that is itself longer than the budget', () => {
    // No sentence boundary to break on, so it has to fall back to clause
    // punctuation and then to whitespace — never mid-word, which is audible.
    const runOn = `${'the fund holds short-term debt and pays a modest yield, '.repeat(8)}and that is all.`;
    const chunks = chunkForSpeech(runOn, BUDGET);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(BUDGET);
    expect(spoken(chunks)).toBe(normalise(runOn));
  });

  it('handles empty and whitespace-only input without producing an utterance', () => {
    expect(chunkForSpeech('', BUDGET)).toEqual([]);
    expect(chunkForSpeech('   \n  ', BUDGET)).toEqual([]);
  });

  it('does not emit an empty chunk from doubled sentence punctuation', () => {
    const odd = 'Really?!  Yes.   It is.';
    const chunks = chunkForSpeech(odd, BUDGET);
    for (const chunk of chunks) expect(chunk.trim().length).toBeGreaterThan(0);
    expect(spoken(chunks)).toBe(normalise(odd));
  });
});
