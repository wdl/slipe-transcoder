import { randomBytes } from 'node:crypto';

import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  Context,
  SQSBatchResponse,
  SQSEvent,
  SQSRecord,
} from 'aws-lambda';

import { ddb, s3, sqs } from '../lib/clients.js';
import { config } from '../lib/config.js';
import { logger, metrics, MetricUnit } from '../lib/powertools.js';
import { WebhookMessageSchema } from '../lib/schemas.js';
import type { JobRow, WebhookQueueMessage } from '../types.js';
import {
  PermanentWebhookError,
  TransientWebhookError,
  deliverWebhook,
} from '../lib/webhook.js';

const MAX_ATTEMPTS = 6;
const BACKOFF_SECONDS = [60, 120, 240, 480, 960, 1920];

export const handler = async (event: SQSEvent, context: Context): Promise<SQSBatchResponse> => {
  logger.addContext(context);
  metrics.addDimension('Function', 'webhook-dispatcher');

  const failures: SQSBatchResponse['batchItemFailures'] = [];
  try {
    for (const rec of event.Records) {
      try {
        await processRecord(rec);
      } catch (err) {
        logger.error('webhook record failed', { error: String(err), messageId: rec.messageId });
        failures.push({ itemIdentifier: rec.messageId });
      }
    }
    return { batchItemFailures: failures };
  } finally {
    metrics.publishStoredMetrics();
  }
};

async function processRecord(rec: SQSRecord): Promise<void> {
  const parsed = WebhookMessageSchema.parse(JSON.parse(rec.body));
  logger.appendKeys({ jobId: parsed.jobId, attempt: parsed.attempt });

  const job = await ddb.send(new GetCommand({ TableName: config.JOBS_TABLE, Key: { id: parsed.jobId } }));
  if (!job.Item) {
    logger.warn('webhook for missing job — dropping');
    return;
  }
  const row = job.Item as JobRow;
  if (!row.callbackUrl || !row.signingSecret) {
    logger.warn('job has no callbackUrl or signing secret — dropping');
    return;
  }
  const secret = row.signingSecret;

  const downloadUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.OUTPUT_BUCKET, Key: `${parsed.jobId}.mp4` }),
    { expiresIn: 24 * 3600 },
  );

  const payload: Record<string, unknown> = {
    deliveryId: randomBytes(16).toString('hex'),
    event: parsed.event,
    jobId: parsed.jobId,
    ...(row.callbackToken ? { token: row.callbackToken } : {}),
    ...(parsed.event === 'job.completed'
      ? {
          url: downloadUrl,
          expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
          sizeBytes: row.downloadSize ?? null,
        }
      : { failure: row.failureMessage ?? 'unknown error' }),
    metadata: row.metadata ?? {},
    occurredAt: new Date().toISOString(),
  };

  try {
    await deliverWebhook({
      url: row.callbackUrl,
      secret,
      deliveryId: String(payload.deliveryId),
      eventName: parsed.event,
      payload,
    });
    metrics.addMetric('WebhookDelivered', MetricUnit.Count, 1);
  } catch (err) {
    if (err instanceof PermanentWebhookError) {
      metrics.addMetric('WebhookPermanentFailure', MetricUnit.Count, 1);
      throw err;
    }
    if (err instanceof TransientWebhookError) {
      metrics.addMetric('WebhookTransientFailure', MetricUnit.Count, 1);
      const nextAttempt = parsed.attempt + 1;
      if (nextAttempt >= MAX_ATTEMPTS) {
        metrics.addMetric('WebhookExhausted', MetricUnit.Count, 1);
        throw err;
      }
      const delay = BACKOFF_SECONDS[nextAttempt] ?? BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]!;
      const next: WebhookQueueMessage = { ...parsed, attempt: nextAttempt };
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: config.WEBHOOK_QUEUE_URL!,
          MessageBody: JSON.stringify(next),
          DelaySeconds: Math.min(delay, 900),
        }),
      );
      logger.info('webhook retry scheduled', { nextAttempt, delaySec: delay });
      return;
    }
    throw err;
  }
}

