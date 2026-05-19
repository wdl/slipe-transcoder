import { randomBytes } from 'node:crypto';

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyHandlerV2,
  APIGatewayProxyStructuredResultV2,
  Context,
} from 'aws-lambda';
import { ulid } from 'ulid';

import { ddb, s3 } from '../lib/clients.js';
import { config } from '../lib/config.js';
import { logger, metrics, MetricUnit } from '../lib/powertools.js';
import { ok, problem } from '../lib/problem-details.js';
import { CreateJobInput, DownloadTtlSchema } from '../lib/schemas.js';
import type { JobRow } from '../types.js';
import { UnsafeUrlError, assertSafeUrl } from '../lib/url-guard.js';

const TERMINAL_STATES = new Set(['completed', 'failed', 'canceled']);

export const handler: APIGatewayProxyHandlerV2 = async (event, context) => {
  logger.addContext(context);
  metrics.addDimension('Function', 'api');

  try {
    const route = `${event.requestContext.http.method} ${event.routeKey ?? event.rawPath}`;
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    if (method === 'GET' && path === '/v1/healthz') return handleHealth();
    if (method === 'POST' && path === '/v1/jobs') return await handleCreate(event, context);

    const idMatch = path.match(/^\/v1\/jobs\/([A-Za-z0-9]+)(\/(download|cancel))?$/);
    if (idMatch) {
      const id = idMatch[1]!;
      const sub = idMatch[3];
      if (method === 'GET' && !sub) return await handleStatus(id);
      if (method === 'GET' && sub === 'download') return await handleDownload(id, event);
      if (method === 'POST' && sub === 'cancel') return await handleCancel(id);
    }

    return problem(404, 'not-found', `no route for ${route}`);
  } catch (err) {
    logger.error('unhandled api error', { error: serializeError(err) });
    metrics.addMetric('ApiUnhandledErrors', MetricUnit.Count, 1);
    return problem(500, 'internal', 'unexpected error');
  } finally {
    metrics.publishStoredMetrics();
  }
};

function handleHealth(): APIGatewayProxyStructuredResultV2 {
  return ok(200, { ok: true, version: process.env.SERVICE_VERSION ?? 'v2.0.0' });
}

async function handleCreate(
  event: APIGatewayProxyEventV2,
  _ctx: Context,
): Promise<APIGatewayProxyStructuredResultV2> {
  let body: unknown;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return problem(400, 'validation-failed', 'request body is not valid JSON');
  }

  const parsed = CreateJobInput.safeParse(body);
  if (!parsed.success) {
    return problem(
      400,
      'validation-failed',
      'one or more fields failed validation',
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  const input = parsed.data;

  if (input.delivery.mode === 'webhook') {
    try {
      await assertSafeUrl(input.delivery.callbackUrl);
    } catch (err) {
      if (err instanceof UnsafeUrlError) {
        return problem(400, 'validation-failed', err.message, [
          { path: 'delivery.callbackUrl', message: err.message },
        ]);
      }
      throw err;
    }
  }

  const id = ulid();
  logger.appendKeys({ jobId: id });

  const apiKeyId = (event.requestContext as { identity?: { apiKeyId?: string } }).identity?.apiKeyId ?? 'anonymous';

  let signingSecret: string | undefined;
  if (input.delivery.mode === 'webhook') {
    signingSecret = randomBytes(32).toString('base64url');
  }

  const nowIso = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 3600;

  const item: JobRow = {
    id,
    apiKeyId,
    state: 'awaiting_upload',
    chunkSec: input.chunkSeconds,
    inputContentType: input.inputContentType,
    inputSizeBytes: input.inputSizeBytes,
    ...(input.inputFilename !== undefined ? { inputFilename: input.inputFilename } : {}),
    ...(input.delivery.mode === 'webhook'
      ? {
          callbackUrl: input.delivery.callbackUrl,
          ...(input.delivery.callbackToken !== undefined ? { callbackToken: input.delivery.callbackToken } : {}),
          ...(signingSecret !== undefined ? { signingSecret } : {}),
        }
      : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    createdAt: nowIso,
    updatedAt: nowIso,
    ttl,
  };

  await ddb.send(
    new PutCommand({
      TableName: config.JOBS_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(id)',
    }),
  );

  const post = await createPresignedPost(s3, {
    Bucket: config.QUEUE_BUCKET,
    Key: id,
    Conditions: [
      ['content-length-range', 1, input.inputSizeBytes],
      ['eq', '$Content-Type', input.inputContentType],
    ],
    Fields: { 'Content-Type': input.inputContentType },
    Expires: 900,
  });

  metrics.addMetric('JobCreated', MetricUnit.Count, 1);

  const responseBody = {
    jobId: id,
    expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
    upload: { url: post.url, fields: post.fields, maxBytes: input.inputSizeBytes },
    statusUrl: buildPublicUrl(`/v1/jobs/${id}`),
    ...(signingSecret ? { delivery: { signingSecret } } : {}),
  };

  return ok(201, responseBody);
}

async function handleStatus(id: string): Promise<APIGatewayProxyStructuredResultV2> {
  logger.appendKeys({ jobId: id });
  const r = await ddb.send(
    new GetCommand({
      TableName: config.JOBS_TABLE,
      Key: { id },
      ConsistentRead: true,
    }),
  );
  if (!r.Item) return problem(404, 'not-found', 'job not found');

  const job = r.Item as JobRow;
  const audioDone = job.audio_done_set ? job.audio_done_set.size : 0;
  const videoDone = job.video_done_set ? job.video_done_set.size : 0;
  const totalChunks = (job.audio_todo ?? 0) + (job.video_todo ?? 0);
  const doneChunks = audioDone + videoDone;
  const percent = totalChunks === 0 ? 0 : Math.floor((doneChunks / totalChunks) * 100);

  return ok(200, {
    jobId: job.id,
    state: job.state,
    progress: {
      audioChunksTotal: job.audio_todo ?? 0,
      audioChunksDone: audioDone,
      videoChunksTotal: job.video_todo ?? 0,
      videoChunksDone: videoDone,
      percent,
    },
    durationSeconds: job.durationSec ?? null,
    chunkSeconds: job.chunkSec,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt ?? null,
    completedAt: job.completedAt ?? null,
    failure: job.state === 'failed' ? { message: job.failureMessage ?? 'unknown error' } : null,
    download:
      job.state === 'completed'
        ? {
            url: buildPublicUrl(`/v1/jobs/${job.id}/download`),
            sizeBytes: job.downloadSize ?? null,
            contentType: 'video/mp4',
          }
        : null,
    metadata: job.metadata ?? {},
  });
}

async function handleDownload(
  id: string,
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  logger.appendKeys({ jobId: id });
  const ttl = DownloadTtlSchema.safeParse(event.queryStringParameters?.ttl);
  if (!ttl.success) return problem(400, 'validation-failed', 'ttl must be between 60 and 86400');

  const r = await ddb.send(new GetCommand({ TableName: config.JOBS_TABLE, Key: { id } }));
  if (!r.Item) return problem(404, 'not-found', 'job not found');
  const job = r.Item as JobRow;
  if (job.state !== 'completed') {
    return problem(409, 'conflict', `job state is ${job.state}, not completed`);
  }

  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: config.OUTPUT_BUCKET, Key: `${id}.mp4` }),
    { expiresIn: ttl.data },
  );
  return ok(200, {
    url,
    expiresAt: new Date(Date.now() + ttl.data * 1000).toISOString(),
    sizeBytes: job.downloadSize ?? null,
    contentType: 'video/mp4',
  });
}

async function handleCancel(id: string): Promise<APIGatewayProxyStructuredResultV2> {
  logger.appendKeys({ jobId: id });
  const nowIso = new Date().toISOString();

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: config.JOBS_TABLE,
        Key: { id },
        UpdateExpression: 'SET #s = :canceled, cancelRequestedAt = :now, updatedAt = :now',
        ConditionExpression: '#s IN (:await, :queued, :processing)',
        ExpressionAttributeNames: { '#s': 'state' },
        ExpressionAttributeValues: {
          ':canceled': 'canceled',
          ':await': 'awaiting_upload',
          ':queued': 'queued',
          ':processing': 'processing',
          ':now': nowIso,
        },
        ReturnValues: 'ALL_OLD',
      }),
    );

    if (!result.Attributes) return problem(404, 'not-found', 'job not found');
    metrics.addMetric('JobsCanceled', MetricUnit.Count, 1);
    return ok(202, { jobId: id, state: 'canceled' });
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      const r = await ddb.send(new GetCommand({ TableName: config.JOBS_TABLE, Key: { id } }));
      if (!r.Item) return problem(404, 'not-found', 'job not found');
      const job = r.Item as JobRow;
      if (TERMINAL_STATES.has(job.state)) {
        return problem(409, 'conflict', `job already in terminal state: ${job.state}`);
      }
      return problem(409, 'conflict', `cannot cancel job in state: ${job.state}`);
    }
    throw err;
  }
}

function buildPublicUrl(path: string): string {
  const base = config.PUBLIC_BASE;
  if (!base) return path;
  return `${base.replace(/\/$/, '')}${path}`;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}
