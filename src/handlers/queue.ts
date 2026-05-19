import { InvokeCommand } from '@aws-sdk/client-lambda';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { Context, S3Event } from 'aws-lambda';

import { ddb, lam, s3 } from '../lib/clients.js';
import { config } from '../lib/config.js';
import { ffprobeDuration } from '../lib/ffmpeg.js';
import { logger, metrics, MetricUnit } from '../lib/powertools.js';
import type { ConverterEvent, JobRow } from '../types.js';

export const handler = async (event: S3Event, context: Context): Promise<void> => {
  logger.addContext(context);
  metrics.addDimension('Function', 'queue');

  try {
    for (const rc of event.Records) {
      const bucket = rc.s3.bucket.name;
      const key = decodeURIComponent(rc.s3.object.key.replace(/\+/g, ' '));
      const id = key;
      logger.appendKeys({ jobId: id });

      const job = await ddb.send(
        new GetCommand({ TableName: config.JOBS_TABLE, Key: { id } }),
      );
      if (!job.Item) {
        logger.warn('orphan upload — no matching job row', { bucket, key });
        continue;
      }
      const row = job.Item as JobRow;
      if (row.state !== 'awaiting_upload') {
        logger.warn('s3 event for job not in awaiting_upload', { state: row.state });
        continue;
      }

      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: 3600 },
      );
      const duration = await ffprobeDuration(url);
      const chunkSec = row.chunkSec ?? config.DEFAULT_CHUNK_SECONDS;
      const numParts = Math.max(1, Math.ceil(duration / chunkSec));

      try {
        await ddb.send(
          new UpdateCommand({
            TableName: config.JOBS_TABLE,
            Key: { id },
            UpdateExpression:
              'SET #s = :queued, video_todo = :n, audio_todo = :one, durationSec = :d, updatedAt = :now',
            ConditionExpression: '#s = :awaiting',
            ExpressionAttributeNames: { '#s': 'state' },
            ExpressionAttributeValues: {
              ':queued': 'queued',
              ':awaiting': 'awaiting_upload',
              ':n': numParts,
              ':one': 1,
              ':d': duration,
              ':now': new Date().toISOString(),
            },
          }),
        );
      } catch (err) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          logger.info('job state changed during probe — skipping');
          continue;
        }
        throw err;
      }

      if (!config.AUDIO_FN || !config.VIDEO_FN) {
        throw new Error('AUDIO_FN / VIDEO_FN env vars not configured');
      }

      const baseEvent: Omit<ConverterEvent, 'part'> = { id, bucket, key };

      await Promise.all([
        lam.send(
          new InvokeCommand({
            FunctionName: config.AUDIO_FN,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify(baseEvent)),
          }),
        ),
        ...Array.from({ length: numParts }, (_, i) =>
          lam.send(
            new InvokeCommand({
              FunctionName: config.VIDEO_FN!,
              InvocationType: 'Event',
              Payload: Buffer.from(JSON.stringify({ ...baseEvent, part: i } satisfies ConverterEvent)),
            }),
          ),
        ),
      ]);

      metrics.addMetric('InputDurationSec', MetricUnit.Seconds, duration);
      metrics.addMetric('ChunksDispatched', MetricUnit.Count, numParts);
      logger.info('chunks dispatched', { numParts, durationSec: duration });
    }
  } finally {
    metrics.publishStoredMetrics();
  }
};
