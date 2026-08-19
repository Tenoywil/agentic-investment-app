import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { sendPartnerWebhook } from './partner-webhooks';

const attempt = {
  deliveryId: '00000000-0000-4000-8000-000000000001',
  eventId: '00000000-0000-4000-8000-000000000002',
  eventType: 'order.accepted',
  endpointUrl: 'https://events.example.com/ccn/audit',
  payload: { specversion: '1.0', id: '00000000-0000-4000-8000-000000000002' },
  signingSecret: 'whsec_test_secret',
};

describe('partner webhook sender', () => {
  test('signs the exact body with stable delivery and event headers', async () => {
    let receivedUrl = '';
    let receivedInit: RequestInit | undefined;
    const now = new Date('2026-08-19T12:00:00.000Z');
    const result = await sendPartnerWebhook(attempt, {
      now: () => now,
      timeoutMs: 1_000,
      guard: {
        fetch: async (url, init) => {
          receivedUrl = url;
          receivedInit = init;
          return new Response(null, { status: 204 });
        },
      },
    });

    expect(result).toEqual({
      delivered: true,
      retryable: false,
      responseStatus: 204,
      errorCode: null,
    });
    expect(receivedUrl).toBe(attempt.endpointUrl);
    const body = String(receivedInit?.body);
    const headers = new Headers(receivedInit?.headers);
    const signature = createHmac('sha256', attempt.signingSecret)
      .update(`${now.toISOString()}.${attempt.eventId}.${body}`)
      .digest('hex');
    expect(headers.get('x-ccn-event-id')).toBe(attempt.eventId);
    expect(headers.get('x-ccn-delivery-id')).toBe(attempt.deliveryId);
    expect(headers.get('x-ccn-signature')).toBe(`v1=${signature}`);
    expect(receivedInit?.redirect).toBe('manual');
  });

  test('retries transient responses but stops on a permanent client error', async () => {
    for (const status of [408, 425, 429, 500, 503]) {
      const result = await sendPartnerWebhook(attempt, {
        now: () => new Date(0),
        timeoutMs: 1_000,
        guard: { fetch: async () => new Response(null, { status }) },
      });
      expect(result.retryable).toBe(true);
      expect(result.errorCode).toBe(`http_${status}`);
    }

    const permanent = await sendPartnerWebhook(attempt, {
      now: () => new Date(0),
      timeoutMs: 1_000,
      guard: { fetch: async () => new Response(null, { status: 400 }) },
    });
    expect(permanent.delivered).toBe(false);
    expect(permanent.retryable).toBe(false);
    expect(permanent.errorCode).toBe('http_400');
  });

  test('bounds an unresponsive receiver with the configured timeout', async () => {
    const result = await sendPartnerWebhook(attempt, {
      now: () => new Date(0),
      timeoutMs: 5,
      guard: {
        fetch: async (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const error = new Error('aborted');
              error.name = 'AbortError';
              reject(error);
            });
          }),
      },
    });
    expect(result).toEqual({
      delivered: false,
      retryable: true,
      responseStatus: null,
      errorCode: 'timeout',
    });
  });
});
