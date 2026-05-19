import { signWebhook } from './hmac.js';
import { logger } from './powertools.js';
import { assertSafeUrl } from './url-guard.js';

const CONNECT_TIMEOUT_MS = 5_000;
const TOTAL_TIMEOUT_MS = 15_000;

export interface WebhookDeliveryInput {
  url: string;
  secret: string;
  deliveryId: string;
  eventName: 'job.completed' | 'job.failed';
  payload: Record<string, unknown>;
}

export class PermanentWebhookError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PermanentWebhookError';
  }
}

export class TransientWebhookError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TransientWebhookError';
  }
}

export async function deliverWebhook(input: WebhookDeliveryInput): Promise<void> {
  await assertSafeUrl(input.url);

  const rawBody = JSON.stringify(input.payload);
  const ts = Math.floor(Date.now() / 1000);
  const signature = signWebhook(input.secret, ts, rawBody);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);

  try {
    const res = await fetch(input.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'slipe-transcoder/v2 (+https://slipe.example.com/webhooks)',
        'slipe-event': input.eventName,
        'slipe-timestamp': String(ts),
        'slipe-delivery-id': input.deliveryId,
        'slipe-signature': signature,
      },
      body: rawBody,
      signal: controller.signal,
      // @ts-expect-error: Node 20 supports this
      connectTimeout: CONNECT_TIMEOUT_MS,
    });

    if (res.ok) {
      logger.info('webhook delivered', { url: input.url, status: res.status, deliveryId: input.deliveryId });
      return;
    }

    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new PermanentWebhookError(`webhook returned ${res.status}`, res.status);
    }
    throw new TransientWebhookError(`webhook returned ${res.status}`, res.status);
  } catch (err) {
    if (err instanceof PermanentWebhookError) throw err;
    if (err instanceof TransientWebhookError) throw err;
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      throw new TransientWebhookError('webhook timed out');
    }
    throw new TransientWebhookError(`webhook error: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
