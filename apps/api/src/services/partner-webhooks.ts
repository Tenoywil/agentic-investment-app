import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ServerConfig } from '@ccn/config';
import type { Database } from '@ccn/db';
import type { FieldCipher, SsrfGuard } from '@ccn/security';
import { sql } from 'drizzle-orm';
import type { Logger } from '../logger';
import { createFieldCipherFrom, createPartnerWebhookGuard } from '../security';

const DISPATCH_INTERVAL_MS = 5_000;
const FIRST_DISPATCH_DELAY_MS = 15_000;
const DELIVERY_LEASE_MS = 120_000;
const BATCH_SIZE = 20;
const WORKER_CONCURRENCY = 5;
const MAX_ATTEMPTS = 6;
const RETRY_BASE_MS = 5_000;
const RETRY_CAP_MS = 60 * 60 * 1_000;

export interface PartnerWebhookAdminRuntime {
  readonly allowedHosts: readonly string[];
  assertTarget(url: string): Promise<void>;
  newEndpointId(): string;
  newSigningSecret(): string;
  encryptSecret(secret: string, endpointId: string): Promise<string>;
}

const secretContext = (endpointId: string) => `partner_webhook_endpoints.secret:${endpointId}`;

/** Request-side webhook capabilities, wired once and injected into the route. */
export function createPartnerWebhookAdminRuntime(config: ServerConfig): PartnerWebhookAdminRuntime {
  const guard = createPartnerWebhookGuard(config);
  let cipher: FieldCipher | undefined;
  const fieldCipher = () => {
    if (!cipher) cipher = createFieldCipherFrom(config);
    return cipher;
  };

  return {
    allowedHosts: config.PARTNER_WEBHOOK_ALLOWED_HOSTS,
    async assertTarget(url) {
      await guard.assertAllowed(url);
    },
    newEndpointId: () => randomUUID(),
    newSigningSecret: () => `whsec_${randomBytes(32).toString('base64url')}`,
    encryptSecret: (secret, endpointId) => fieldCipher().encrypt(secret, secretContext(endpointId)),
  };
}

export interface WebhookAttempt {
  deliveryId: string;
  eventId: string;
  eventType: string;
  endpointUrl: string;
  payload: unknown;
  signingSecret: string;
}

export interface WebhookAttemptResult {
  delivered: boolean;
  retryable: boolean;
  responseStatus: number | null;
  errorCode: 'timeout' | 'network_or_policy_error' | `http_${number}` | null;
}

export interface WebhookSenderDeps {
  guard: Pick<SsrfGuard, 'fetch'>;
  timeoutMs: number;
  now(): Date;
}

/**
 * Send one signed CloudEvents-style envelope. The receiver verifies HMAC over
 * timestamp + stable event id + exact request body, and can dedupe on event id.
 * Response bodies are deliberately never read or logged.
 */
export async function sendPartnerWebhook(
  attempt: WebhookAttempt,
  deps: WebhookSenderDeps,
): Promise<WebhookAttemptResult> {
  const body = JSON.stringify(attempt.payload);
  const timestamp = deps.now().toISOString();
  const signature = createHmac('sha256', attempt.signingSecret)
    .update(`${timestamp}.${attempt.eventId}.${body}`)
    .digest('hex');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);

  try {
    const response = await deps.guard.fetch(attempt.endpointUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/cloudevents+json',
        'user-agent': 'CCN-Partner-Webhook/1.0',
        'x-ccn-delivery-id': attempt.deliveryId,
        'x-ccn-event-id': attempt.eventId,
        'x-ccn-event-type': attempt.eventType,
        'x-ccn-timestamp': timestamp,
        'x-ccn-signature': `v1=${signature}`,
      },
      body,
      signal: controller.signal,
      redirect: 'manual',
    });
    if (response.status >= 200 && response.status < 300) {
      return {
        delivered: true,
        retryable: false,
        responseStatus: response.status,
        errorCode: null,
      };
    }
    const retryable =
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500;
    return {
      delivered: false,
      retryable,
      responseStatus: response.status,
      errorCode: `http_${response.status}`,
    };
  } catch (error) {
    const timedOut =
      controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
    return {
      delivered: false,
      retryable: true,
      responseStatus: null,
      errorCode: timedOut ? 'timeout' : 'network_or_policy_error',
    };
  } finally {
    clearTimeout(timeout);
  }
}

interface ClaimedDelivery {
  delivery_id: string;
  endpoint_id: string;
  partner_id: string;
  event_id: string;
  event_type: string;
  payload: unknown;
  attempt_count: number;
  lock_token: string;
  endpoint_url: string;
  secret_ciphertext: string;
}

export interface PartnerWebhookDispatcherDeps {
  db: Database;
  logger: Logger;
  guard: SsrfGuard;
  cipher: FieldCipher;
  timeoutMs: number;
  now(): Date;
  random(): number;
}

async function finishDelivery(
  db: Database,
  args: {
    deliveryId: string;
    lockToken: string;
    status: 'delivered' | 'failed' | 'dead';
    nextAttemptAt: Date | null;
    responseStatus: number | null;
    errorCode: string | null;
  },
): Promise<boolean> {
  const rows = (await db.execute(
    sql`select finish_partner_webhook_delivery(
      ${args.deliveryId}::uuid,
      ${args.lockToken}::uuid,
      ${args.status}::webhook_delivery_status,
      ${args.nextAttemptAt}::timestamptz,
      ${args.responseStatus}::integer,
      ${args.errorCode}::text
    ) as finished`,
  )) as unknown as { finished: boolean }[];
  return rows[0]?.finished === true;
}

function logExpiredClaim(claim: ClaimedDelivery, deps: PartnerWebhookDispatcherDeps): void {
  deps.logger.warn('partner webhook completion ignored after lease turnover', {
    deliveryId: claim.delivery_id,
    partnerId: claim.partner_id,
    eventType: claim.event_type,
    attempt: claim.attempt_count,
  });
}

async function dispatchOne(
  claim: ClaimedDelivery,
  deps: PartnerWebhookDispatcherDeps,
): Promise<void> {
  let signingSecret: string;
  try {
    signingSecret = await deps.cipher.decrypt(
      claim.secret_ciphertext,
      secretContext(claim.endpoint_id),
    );
  } catch {
    const finalized = await finishDelivery(deps.db, {
      deliveryId: claim.delivery_id,
      lockToken: claim.lock_token,
      status: 'dead',
      nextAttemptAt: null,
      responseStatus: null,
      errorCode: 'secret_decryption_failed',
    });
    if (!finalized) {
      logExpiredClaim(claim, deps);
      return;
    }
    deps.logger.error('partner webhook signing secret could not be decrypted', {
      deliveryId: claim.delivery_id,
      partnerId: claim.partner_id,
      eventType: claim.event_type,
    });
    return;
  }

  const result = await sendPartnerWebhook(
    {
      deliveryId: claim.delivery_id,
      eventId: claim.event_id,
      eventType: claim.event_type,
      endpointUrl: claim.endpoint_url,
      payload: claim.payload,
      signingSecret,
    },
    deps,
  );

  if (result.delivered) {
    const finalized = await finishDelivery(deps.db, {
      deliveryId: claim.delivery_id,
      lockToken: claim.lock_token,
      status: 'delivered',
      nextAttemptAt: null,
      responseStatus: result.responseStatus,
      errorCode: null,
    });
    if (!finalized) {
      logExpiredClaim(claim, deps);
      return;
    }
    deps.logger.info('partner webhook delivered', {
      deliveryId: claim.delivery_id,
      partnerId: claim.partner_id,
      eventType: claim.event_type,
      attempt: claim.attempt_count,
      responseStatus: result.responseStatus,
    });
    return;
  }

  const canRetry = result.retryable && claim.attempt_count < MAX_ATTEMPTS;
  const retryWindow = Math.min(
    RETRY_CAP_MS,
    RETRY_BASE_MS * 2 ** Math.max(0, claim.attempt_count - 1),
  );
  const retryDelay = Math.max(1_000, Math.floor(deps.random() * retryWindow));
  const finalized = await finishDelivery(deps.db, {
    deliveryId: claim.delivery_id,
    lockToken: claim.lock_token,
    status: canRetry ? 'failed' : 'dead',
    nextAttemptAt: canRetry ? new Date(deps.now().getTime() + retryDelay) : null,
    responseStatus: result.responseStatus,
    errorCode: result.errorCode,
  });
  if (!finalized) {
    logExpiredClaim(claim, deps);
    return;
  }
  deps.logger[canRetry ? 'warn' : 'error'](
    canRetry ? 'partner webhook delivery will retry' : 'partner webhook delivery stopped',
    {
      deliveryId: claim.delivery_id,
      partnerId: claim.partner_id,
      eventType: claim.event_type,
      attempt: claim.attempt_count,
      responseStatus: result.responseStatus,
      errorCode: result.errorCode,
    },
  );
}

/** Claim and deliver one bounded batch. Safe to call from multiple replicas. */
export async function dispatchPartnerWebhookBatch(
  deps: PartnerWebhookDispatcherDeps,
): Promise<number> {
  const claims = (await deps.db.execute(
    sql`select * from claim_partner_webhook_deliveries(${BATCH_SIZE}, ${DELIVERY_LEASE_MS})`,
  )) as unknown as ClaimedDelivery[];

  for (let offset = 0; offset < claims.length; offset += WORKER_CONCURRENCY) {
    await Promise.all(
      claims.slice(offset, offset + WORKER_CONCURRENCY).map((claim) => dispatchOne(claim, deps)),
    );
  }
  return claims.length;
}

/** Start the bounded background dispatcher; returns a stop function for tests. */
export function startPartnerWebhookDispatcher(deps: PartnerWebhookDispatcherDeps): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchPartnerWebhookBatch(deps);
    } catch (error) {
      deps.logger.error('partner webhook dispatcher failed', { error });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(tick, FIRST_DISPATCH_DELAY_MS);
  const timer = setInterval(tick, DISPATCH_INTERVAL_MS);
  deps.logger.info('partner webhook dispatcher started', {
    intervalMs: DISPATCH_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    concurrency: WORKER_CONCURRENCY,
  });
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}

/** Production dispatcher dependencies, kept at the composition root. */
export function createPartnerWebhookDispatcherDeps(
  config: ServerConfig,
  db: Database,
  logger: Logger,
): PartnerWebhookDispatcherDeps {
  return {
    db,
    logger,
    guard: createPartnerWebhookGuard(config),
    cipher: createFieldCipherFrom(config),
    timeoutMs: config.PARTNER_WEBHOOK_TIMEOUT_MS,
    now: () => new Date(),
    random: Math.random,
  };
}
