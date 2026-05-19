import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Upload } from '@aws-sdk/lib-storage';
import type { Context } from 'aws-lambda';

import { ddb, s3 } from '../lib/clients.js';
import { config } from '../lib/config.js';
import { spawnFfmpeg } from '../lib/ffmpeg.js';
import { logger, metrics, MetricUnit } from '../lib/powertools.js';
import { ConverterEventSchema } from '../lib/schemas.js';

export const handler = async (raw: unknown, context: Context): Promise<void> => {
  logger.addContext(context);
  metrics.addDimension('Function', 'audio-converter');

  const parsed = ConverterEventSchema.parse(raw);
  logger.appendKeys({ jobId: parsed.id, kind: 'audio' });
  const started = Date.now();

  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
      { expiresIn: 3600 },
    );

    const { stdout, done } = spawnFfmpeg([
      '-y',
      '-i', url,
      '-c:a', 'aac',
      '-b:a', '128000',
      '-vn',
      '-f', 'adts',
      '-',
    ]);

    const uploader = new Upload({
      client: s3,
      params: {
        Bucket: config.TEMP_BUCKET,
        Key: `${parsed.id}/audio.aac`,
        Body: stdout,
        ContentType: 'audio/aac',
      },
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
    });

    const [, exitCode] = await Promise.all([uploader.done(), done]);
    if (exitCode !== 0) throw new Error(`ffmpeg exited ${exitCode}`);

    try {
      await ddb.send(
        new UpdateCommand({
          TableName: config.JOBS_TABLE,
          Key: { id: parsed.id },
          UpdateExpression: 'ADD audio_done_set :p SET updatedAt = :now, #s = :processing',
          ConditionExpression: '#s IN (:queued, :processing)',
          ExpressionAttributeNames: { '#s': 'state' },
          ExpressionAttributeValues: {
            ':p': new Set([0]),
            ':queued': 'queued',
            ':processing': 'processing',
            ':now': new Date().toISOString(),
          },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        logger.info('audio chunk completed but job no longer accepting updates');
        return;
      }
      throw err;
    }

    metrics.addMetric('AudioChunkDurationMs', MetricUnit.Milliseconds, Date.now() - started);
    metrics.addMetric('AudioChunkSuccess', MetricUnit.Count, 1);
  } catch (err) {
    metrics.addMetric('AudioChunkFailures', MetricUnit.Count, 1);
    logger.error('audio chunk failed', { error: String(err) });
    throw err;
  } finally {
    metrics.publishStoredMetrics();
  }
};
