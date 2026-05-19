import { InvokeCommand } from '@aws-sdk/client-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  AttributeValue as DDBAttributeValue,
} from '@aws-sdk/client-dynamodb';
import type {
  Context,
  DynamoDBBatchResponse,
  DynamoDBStreamEvent,
} from 'aws-lambda';

import { lam } from '../lib/clients.js';
import { config } from '../lib/config.js';
import { logger, metrics, MetricUnit } from '../lib/powertools.js';
import type { JobRow, MergeEvent } from '../types.js';

export const handler = async (
  event: DynamoDBStreamEvent,
  context: Context,
): Promise<DynamoDBBatchResponse> => {
  logger.addContext(context);
  metrics.addDimension('Function', 'stream');

  const failures: DynamoDBBatchResponse['batchItemFailures'] = [];
  try {
    for (const rc of event.Records) {
      try {
        if (rc.eventName === 'REMOVE' || !rc.dynamodb?.NewImage) continue;
        if (!config.MERGE_FN) throw new Error('MERGE_FN env var not configured');

        const newImage = unmarshall(
          rc.dynamodb.NewImage as Record<string, DDBAttributeValue>,
        ) as JobRow;
        logger.appendKeys({ jobId: newImage.id });

        if (newImage.state !== 'queued' && newImage.state !== 'processing') continue;

        const audioDone = newImage.audio_done_set ? sizeOf(newImage.audio_done_set) : 0;
        const videoDone = newImage.video_done_set ? sizeOf(newImage.video_done_set) : 0;
        const audioTodo = newImage.audio_todo ?? 0;
        const videoTodo = newImage.video_todo ?? 0;

        if (audioTodo === 0 || videoTodo === 0) continue;
        if (audioDone !== audioTodo || videoDone !== videoTodo) continue;

        const payload: MergeEvent = { id: newImage.id, parts: videoTodo };
        await lam.send(
          new InvokeCommand({
            FunctionName: config.MERGE_FN,
            InvocationType: 'Event',
            Payload: Buffer.from(JSON.stringify(payload)),
          }),
        );
        metrics.addMetric('MergeInvoked', MetricUnit.Count, 1);
        logger.info('merge invoked', { parts: videoTodo });
      } catch (err) {
        logger.error('stream record failed', { error: String(err), seq: rc.dynamodb?.SequenceNumber });
        if (rc.dynamodb?.SequenceNumber) {
          failures.push({ itemIdentifier: rc.dynamodb.SequenceNumber });
        }
      }
    }
    return { batchItemFailures: failures };
  } finally {
    metrics.publishStoredMetrics();
  }
};

function sizeOf(setLike: unknown): number {
  if (setLike instanceof Set) return setLike.size;
  if (Array.isArray(setLike)) return setLike.length;
  if (setLike && typeof setLike === 'object' && 'size' in setLike) {
    const s = (setLike as { size: unknown }).size;
    return typeof s === 'number' ? s : 0;
  }
  return 0;
}
