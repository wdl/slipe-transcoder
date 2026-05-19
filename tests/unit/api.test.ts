import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as UrlGuardModule from '../../src/lib/url-guard.js';

vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: vi.fn(async () => ({
    url: 'https://test-bucket.s3.amazonaws.com',
    fields: { key: 'abc', 'Content-Type': 'video/mp4' },
  })),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://signed/get'),
}));
vi.mock('../../src/lib/url-guard.js', async () => {
  const actual = await vi.importActual<typeof UrlGuardModule>('../../src/lib/url-guard.js');
  return {
    ...actual,
    assertSafeUrl: vi.fn(async () => undefined),
  };
});

const ddbMock = mockClient(DynamoDBDocumentClient);
const s3Mock = mockClient(S3Client);

const ctx: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'api',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn',
  memoryLimitInMB: '512',
  awsRequestId: 'req',
  logGroupName: 'g',
  logStreamName: 's',
  getRemainingTimeInMillis: () => 30_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};

function evt(method: string, path: string, body?: unknown): APIGatewayProxyEventV2 {
  const e: APIGatewayProxyEventV2 = {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: '000000000000',
      apiId: 'api',
      domainName: 'd',
      domainPrefix: 'd',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'r',
      routeKey: `${method} ${path}`,
      stage: 'v1',
      time: 'now',
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
  if (body !== undefined) {
    e.body = JSON.stringify(body);
  }
  return e;
}

beforeEach(() => {
  ddbMock.reset();
  s3Mock.reset();
});

describe('api handler', () => {
  it('GET /v1/healthz returns 200', async () => {
    const { handler } = await import('../../src/handlers/api.js');
    const r = await handler(evt('GET', '/v1/healthz'), ctx, () => {});
    expect(r).toMatchObject({ statusCode: 200 });
  });

  it('POST /v1/jobs rejects invalid body', async () => {
    const { handler } = await import('../../src/handlers/api.js');
    const r = await handler(evt('POST', '/v1/jobs', { foo: 'bar' }), ctx, () => {});
    expect(r).toMatchObject({ statusCode: 400 });
  });

  it('POST /v1/jobs creates a poll-mode job', async () => {
    ddbMock.on(PutCommand).resolves({});
    const { handler } = await import('../../src/handlers/api.js');
    const r = await handler(
      evt('POST', '/v1/jobs', {
        inputSizeBytes: 1024,
        inputContentType: 'video/mp4',
        delivery: { mode: 'poll' },
      }),
      ctx,
      () => {},
    );
    expect(r).toMatchObject({ statusCode: 201 });
    const body = JSON.parse((r as { body: string }).body);
    expect(body.jobId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.delivery).toBeUndefined();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(1);
  });

  it('POST /v1/jobs webhook mode returns signing secret once', async () => {
    ddbMock.on(PutCommand).resolves({});
    const { handler } = await import('../../src/handlers/api.js');
    const r = await handler(
      evt('POST', '/v1/jobs', {
        inputSizeBytes: 1024,
        inputContentType: 'video/mp4',
        delivery: { mode: 'webhook', callbackUrl: 'https://hooks.example.com/cb' },
      }),
      ctx,
      () => {},
    );
    expect(r).toMatchObject({ statusCode: 201 });
    const body = JSON.parse((r as { body: string }).body);
    expect(typeof body.delivery.signingSecret).toBe('string');
  });

  it('GET /v1/jobs/:id returns 404 for missing job', async () => {
    ddbMock.on(GetCommand).resolves({});
    const { handler } = await import('../../src/handlers/api.js');
    const r = await handler(evt('GET', '/v1/jobs/missing'), ctx, () => {});
    expect(r).toMatchObject({ statusCode: 404 });
  });

  it('POST /v1/jobs/:id/cancel succeeds when in queued', async () => {
    ddbMock.on(UpdateCommand).resolves({ Attributes: { id: 'x', state: 'queued' } });
    const { handler } = await import('../../src/handlers/api.js');
    const r = await handler(evt('POST', '/v1/jobs/x/cancel'), ctx, () => {});
    expect(r).toMatchObject({ statusCode: 202 });
  });
});
