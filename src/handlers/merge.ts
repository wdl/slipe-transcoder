import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { Upload } from '@aws-sdk/lib-storage';
import type { Context } from 'aws-lambda';

import { ddb, s3, sqs } from '../lib/clients.js';
import { config } from '../lib/config.js';
import { spawnMerge } from '../lib/ffmpeg.js';
import { logger, metrics, MetricUnit } from '../lib/powertools.js';
import { MergeEventSchema } from '../lib/schemas.js';
import type { JobRow, WebhookQueueMessage } from '../types.js';

export const handler = async (raw: unknown, context: Context): Promise<void> => {
  logger.addContext(context);
  metrics.addDimension('Function', 'merge');

  const ev = MergeEventSchema.parse(raw);
  logger.appendKeys({ jobId: ev.id });
  const start = Date.now();

  if (!(await acquireMergeLock(ev.id))) {
    logger.info('merge already in progress or terminal — skipping');
    metrics.publishStoredMetrics();
    return;
  }

  const tmp = join('/tmp', context.awsRequestId);
  await mkdir(tmp, { recursive: true });

  try {
    const [segmentUrls, audioUrl] = await Promise.all([
      Promise.all(
        Array.from({ length: ev.parts }, (_, i) =>
          getSignedUrl(
            s3,
            new GetObjectCommand({
              Bucket: config.TEMP_BUCKET,
              Key: `${ev.id}/${String(i).padStart(4, '0')}.ts`,
            }),
            { expiresIn: 3600 },
          ),
        ),
      ),
      getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: config.TEMP_BUCKET, Key: `${ev.id}/audio.aac` }),
        { expiresIn: 3600 },
      ),
    ]);

    const listPath = join(tmp, 'list.txt');
    await writeFile(listPath, segmentUrls.map((u) => `file '${u}'`).join('\n'), 'utf8');

    const { stdout, done } = spawnMerge(listPath, audioUrl);

    const uploader = new Upload({
      client: s3,
      params: {
        Bucket: config.OUTPUT_BUCKET,
        Key: `${ev.id}.mp4`,
        Body: stdout,
        ContentType: 'video/mp4',
      },
      queueSize: 4,
      partSize: 8 * 1024 * 1024,
    });

    const [, exitCode] = await Promise.all([uploader.done(), done]);
    if (exitCode !== 0) throw new Error(`ffmpeg merge exit code ${exitCode}`);

    const head = await s3.send(
      new HeadObjectCommand({ Bucket: config.OUTPUT_BUCKET, Key: `${ev.id}.mp4` }),
    );
    const sizeBytes = head.ContentLength ?? 0;

    const job = await markCompleted(ev.id, sizeBytes);

    if (job?.callbackUrl && config.WEBHOOK_QUEUE_URL) {
      const msg: WebhookQueueMessage = { jobId: ev.id, event: 'job.completed', attempt: 0 };
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: config.WEBHOOK_QUEUE_URL,
          MessageBody: JSON.stringify(msg),
        }),
      );
    }

    metrics.addMetric('MergeDurationMs', MetricUnit.Milliseconds, Date.now() - start);
    metrics.addMetric('JobsCompleted', MetricUnit.Count, 1);
    logger.info('merge complete', { sizeBytes });
  } catch (err) {
    await markFailed(ev.id, err);
    metrics.addMetric('MergeFailures', MetricUnit.Count, 1);
    logger.error('merge failed', { error: String(err) });
    throw err;
  } finally {
    await rm(tmp, { recursive: true, force: true });
    metrics.publishStoredMetrics();
  }
};

async function acquireMergeLock(id: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.JOBS_TABLE,
        Key: { id },
        UpdateExpression: 'SET #s = :merging, mergeStartedAt = :now, updatedAt = :now',
        ConditionExpression: '#s IN (:queued, :processing)',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: {
          ':merging': 'merging',
          ':queued': 'queued',
          ':processing': 'processing',
          ':now': new Date().toISOString(),
        },
      }),
    );
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

async function markCompleted(id: string, sizeBytes: number): Promise<JobRow | undefined> {
  const nowIso = new Date().toISOString();
  const r = await ddb.send(
    new UpdateCommand({
      TableName: config.JOBS_TABLE,
      Key: { id },
      UpdateExpression:
        'SET #s = :done, completedAt = :now, downloadSize = :sz, updatedAt = :now',
      ConditionExpression: '#s = :merging',
      ExpressionAttributeNames: { '#s': 'state' },
      ExpressionAttributeValues: {
        ':done': 'completed',
        ':merging': 'merging',
        ':now': nowIso,
        ':sz': sizeBytes,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return r.Attributes as JobRow | undefined;
}

async function markFailed(id: string, err: unknown): Promise<void> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: config.JOBS_TABLE,
        Key: { id },
        UpdateExpression: 'SET #s = :failed, failureMessage = :msg, updatedAt = :now',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':msg': err instanceof Error ? err.message : String(err),
          ':now': new Date().toISOString(),
        },
      }),
    );
  } catch (e) {
    logger.error('failed to mark job failed', { error: String(e) });
  }

  if (config.WEBHOOK_QUEUE_URL) {
    try {
      const job = await ddb.send(new GetCommand({ TableName: config.JOBS_TABLE, Key: { id } }));
      if (job.Item && (job.Item as JobRow).callbackUrl) {
        const msg: WebhookQueueMessage = { jobId: id, event: 'job.failed', attempt: 0 };
        await sqs.send(
          new SendMessageCommand({
            QueueUrl: config.WEBHOOK_QUEUE_URL,
            MessageBody: JSON.stringify(msg),
          }),
        );
      }
    } catch (e) {
      logger.error('failed to enqueue failure webhook', { error: String(e) });
    }
  }
}
