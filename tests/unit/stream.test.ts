import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { marshall } from '@aws-sdk/util-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type {
  Context,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from 'aws-lambda';
import { beforeEach, describe, expect, it } from 'vitest';

import { handler } from '../../src/handlers/stream.js';

const lamMock = mockClient(LambdaClient);

const baseContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'stream',
  functionVersion: '$LATEST',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:stream',
  memoryLimitInMB: '256',
  awsRequestId: 'test',
  logGroupName: 'g',
  logStreamName: 's',
  getRemainingTimeInMillis: () => 30_000,
  done: () => undefined,
  fail: () => undefined,
  succeed: () => undefined,
};

function makeEvent(image: Record<string, unknown>): DynamoDBStreamEvent {
  const NewImage = marshall(image, { removeUndefinedValues: true }) as unknown as Record<
    string,
    AttributeValue
  >;
  const rec = {
    eventName: 'MODIFY' as const,
    dynamodb: {
      ApproximateCreationDateTime: 1,
      Keys: { id: { S: image.id as string } },
      NewImage,
      SequenceNumber: '1',
      SizeBytes: 1,
      StreamViewType: 'NEW_AND_OLD_IMAGES' as const,
    },
  } as unknown as DynamoDBRecord;
  return { Records: [rec] };
}

beforeEach(() => {
  lamMock.reset();
});

describe('stream handler', () => {
  it('invokes merge when all chunks done', async () => {
    lamMock.on(InvokeCommand).resolves({});
    const event = makeEvent({
      id: 'job1',
      state: 'processing',
      audio_todo: 1,
      audio_done_set: new Set([0]),
      video_todo: 3,
      video_done_set: new Set([0, 1, 2]),
    });
    const r = await handler(event, baseContext);
    expect(r.batchItemFailures).toEqual([]);
    expect(lamMock.commandCalls(InvokeCommand)).toHaveLength(1);
    const payload = JSON.parse(Buffer.from(lamMock.commandCalls(InvokeCommand)[0]!.args[0].input.Payload as Uint8Array).toString());
    expect(payload).toEqual({ id: 'job1', parts: 3 });
  });

  it('does not invoke merge when chunks incomplete', async () => {
    const event = makeEvent({
      id: 'job2',
      state: 'processing',
      audio_todo: 1,
      audio_done_set: new Set([0]),
      video_todo: 3,
      video_done_set: new Set([0, 1]),
    });
    const r = await handler(event, baseContext);
    expect(r.batchItemFailures).toEqual([]);
    expect(lamMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });

  it('skips when state is not queued/processing', async () => {
    const event = makeEvent({
      id: 'job3',
      state: 'merging',
      audio_todo: 1,
      audio_done_set: new Set([0]),
      video_todo: 1,
      video_done_set: new Set([0]),
    });
    const r = await handler(event, baseContext);
    expect(r.batchItemFailures).toEqual([]);
    expect(lamMock.commandCalls(InvokeCommand)).toHaveLength(0);
  });
});
