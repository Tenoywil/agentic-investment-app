import { afterEach, describe, expect, it } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentDisplayCard, AllocationDisplay } from '../app/_components/agent-displays';
import { agentFeedPreview } from '../app/_lib/utils';
import {
  type AllocationDisplayData,
  type PipelineDisplayData,
  streamAgentMessage,
} from '../lib/agent-api';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/**
 * The home screen's "Agent activity" feed shows the agent's recent
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

describe('agent SSE client', () => {
  it('delivers split text, display and proposal frames before completing once', async () => {
    const frames = [
      'data: {"delta":"Hello "}\n\n',
      'data: {"delta":"investor."}\n\n',
      'event: display\ndata: {"kind":"fit","data":{"score":84}}\n\n',
      'event: proposal\ndata: {"instrumentId":"bond-1","name":"Bond","amount":"US$1,000","amountMinor":"100000","decision":"requires_approval","code":"approval_threshold","reasons":[],"summary":"Fits your band."}\n\n',
      'event: done\ndata: [DONE]\n\n',
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        const wire = frames.join('');
        // Deliberately cut through frame boundaries and JSON strings.
        for (const part of [wire.slice(0, 19), wire.slice(19, 77), wire.slice(77)]) {
          controller.enqueue(encoder.encode(part));
        }
        controller.close();
      },
    });
    globalThis.fetch = (async () => new Response(body, { status: 200 })) as unknown as typeof fetch;

    let text = '';
    let done = 0;
    const errors: string[] = [];
    const displays: string[] = [];
    const proposals: string[] = [];
    await streamAgentMessage('hello', {
      onDelta: (delta) => {
        text += delta;
      },
      onDone: () => {
        done += 1;
      },
      onError: (message) => errors.push(message),
      onDisplay: (display) => displays.push(display.kind),
      onProposal: (proposal) => proposals.push(proposal.instrumentId),
    });

    expect(text).toBe('Hello investor.');
    expect(displays).toEqual(['fit']);
    expect(proposals).toEqual(['bond-1']);
    expect(errors).toEqual([]);
    expect(done).toBe(1);
  });

  it('surfaces an agent error and still clears the pending state exactly once', async () => {
    globalThis.fetch = (async () =>
      new Response(
        'event: error\ndata: {"error":"the agent is temporarily unavailable"}\n\n' +
          'event: done\ndata: [DONE]\n\n',
        { status: 200 },
      )) as unknown as typeof fetch;

    const errors: string[] = [];
    let done = 0;
    await streamAgentMessage('hello', {
      onDelta: () => {},
      onDone: () => {
        done += 1;
      },
      onError: (message) => errors.push(message),
    });

    expect(errors).toEqual(['the agent is temporarily unavailable']);
    expect(done).toBe(1);
  });
});

describe('agent allocation visual', () => {
  it('renders an accessible pie chart and current-versus-target bar graph', () => {
    const data: AllocationDisplayData = {
      currency: 'USD',
      total: 'US$10,000',
      band: 'balanced income',
      byType: [
        {
          key: 'cash',
          label: 'Cash',
          valueMinor: '600000',
          value: 'US$6,000',
          pct: 60,
          targetPct: 20,
          gapPts: -40,
        },
        {
          key: 'bond',
          label: 'Bonds',
          valueMinor: '400000',
          value: 'US$4,000',
          pct: 40,
          targetPct: 50,
          gapPts: 10,
        },
      ],
      byPartner: [],
      byCurrency: [],
    };

    const html = renderToStaticMarkup(createElement(AllocationDisplay, { data }));
    expect(html).toContain('data-chart="allocation-pie"');
    expect(html).toContain('Portfolio allocation pie chart: Cash 60%, Bonds 40%');
    expect(html).toContain('data-chart="allocation-bars"');
    expect(html).toContain('Bar graph comparing current portfolio allocation');
    expect(html).toContain('Cash: 60% current, 20% target');
  });
});

describe('agent pipeline visual', () => {
  it('renders the deterministic diaspora comparison beside the prepared proposal', () => {
    const data: PipelineDisplayData = {
      trace: [],
      proposal: {
        instrumentId: 'bond-1',
        name: 'Regional Bond',
        partner: 'Licensed Partner',
        amount: 'US$1,000',
        decision: 'auto_act',
        diasporaComparison:
          'Diaspora comparison: relative to a like-for-like Canadian bond. Compare fees, tax, currency risk, liquidity and investor protections.',
      },
    };

    const html = renderToStaticMarkup(
      createElement(AgentDisplayCard, { display: { kind: 'pipeline', data } }),
    );
    expect(html).toContain('Prepared:');
    expect(html).toContain('Waiting for your confirmation before routing.');
    expect(html).toContain('Diaspora comparison:');
    expect(html).toContain('like-for-like Canadian bond');
  });
});
