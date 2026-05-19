import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Upload } from '@aws-sdk/lib-storage';
import type { Context } from 'aws-lambda';

import { ddb, s3 } from '../lib/clients.js';
import { config } from '../lib/config.js';
import { secondsToHms, spawnFfmpeg } from '../lib/ffmpeg.js';
import { logger, metrics, MetricUnit } from '../lib/powertools.js';
import { ConverterEventSchema } from '../lib/schemas.js';

export const handler = async (raw: unknown, context: Context): Promise<void> => {
  logger.addContext(context);
  metrics.addDimension('Function', 'video-converter');

  const parsed = ConverterEventSchema.parse(raw);
  if (parsed.part === undefined) {
    throw new Error('video converter event missing required `part` field');
  }
  const part = parsed.part;
  logger.appendKeys({ jobId: parsed.id, kind: 'video', part });
  const started = Date.now();

  try {
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
      { expiresIn: 3600 },
    );

    const chunkSec = config.DEFAULT_CHUNK_SECONDS;
    const offset = secondsToHms(part * chunkSec);
    const duration = secondsToHms(chunkSec);

    const { stdout, done } = spawnFfmpeg([
      '-y',
      '-ss', offset,
      '-t', duration,
      '-i', url,
      '-sn',
      '-an',
      '-vcodec', 'libx264',
      '-preset', 'veryfast',
      '-bsf:v', 'h264_mp4toannexb',
      '-f', 'mpegts',
      '-',
    ]);

    const uploader = new Upload({
      client: s3,
      params: {
        Bucket: config.TEMP_BUCKET,
        Key: `${parsed.id}/${String(part).padStart(4, '0')}.ts`,
        Body: stdout,
        ContentType: 'video/mp2t',
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
          UpdateExpression: 'ADD video_done_set :p SET updatedAt = :now, #s = :processing',
          ConditionExpression: '#s IN (:queued, :processing)',
          ExpressionAttributeNames: { '#s': 'state' },
          ExpressionAttributeValues: {
            ':p': new Set([part]),
            ':queued': 'queued',
            ':processing': 'processing',
            ':now': new Date().toISOString(),
          },
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
        logger.info('video chunk completed but job no longer accepting updates');
        return;
      }
      throw err;
    }

    metrics.addMetric('VideoChunkDurationMs', MetricUnit.Milliseconds, Date.now() - started);
    metrics.addMetric('VideoChunkSuccess', MetricUnit.Count, 1);
  } catch (err) {
    metrics.addMetric('VideoChunkFailures', MetricUnit.Count, 1);
    logger.error('video chunk failed', { error: String(err) });
    throw err;
  } finally {
    metrics.publishStoredMetrics();
  }
};
