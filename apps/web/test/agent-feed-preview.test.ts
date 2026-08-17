import { describe, expect, it } from 'bun:test';
import { agentFeedPreview } from '../app/_lib/utils';

/**
 * The home screen's "Acted on your behalf" feed shows the agent's recent
 * replies in a two-line clamp. The agent answers comparison questions in GFM
 * markdown, and the feed used to render that syntax raw — a row of pipes and
 * dashes where a person expected a sentence (the screenshot that prompted
 * this). The preview keeps the reply's prose and drops everything that only
 * makes sense rendered.
 */
describe('agentFeedPreview', () => {
  it('drops table rows and rules, keeping the prose around them', () => {
    const reply = [
      "Here's what's available today, ranked by return potential:",
      '',
      '| Asset | Yield | Risk |',
      '|-------|-------|------|',
      '| **Global Equity Fund** | 11.2%* | Medium |',
      '',
      'The 11.2% is a 5-year average.',
    ].join('\n');
    const preview = agentFeedPreview(reply);
    expect(preview).toBe(
      "Here's what's available today, ranked by return potential: The 11.2% is a 5-year average.",
    );
  });

  it('unwraps emphasis, headings, links, bullets and legacy <b> tags', () => {
    const reply = [
      '## Your week',
      '- You have **US$13,400 in cash** — see [the marketplace](/opportunities).',
      '- <b>Nothing</b> is invested yet, `cash` only.',
    ].join('\n');
    expect(agentFeedPreview(reply)).toBe(
      'Your week You have US$13,400 in cash — see the marketplace. Nothing is invested yet, cash only.',
    );
  });

  it('still says something honest for a table-only reply', () => {
    const reply = '| Asset | Yield |\n|---|---|\n| Bond | 8.9% |';
    expect(agentFeedPreview(reply)).toBe('Shared a breakdown with you. Open the agent to see it.');
  });

  it('passes plain prose through untouched', () => {
    expect(agentFeedPreview('Swept US$400 of idle cash into the money market fund.')).toBe(
      'Swept US$400 of idle cash into the money market fund.',
    );
  });
});
