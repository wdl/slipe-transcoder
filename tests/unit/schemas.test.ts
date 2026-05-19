import { describe, expect, it } from 'vitest';

import { CreateJobInput, MergeEventSchema, WebhookMessageSchema } from '../../src/lib/schemas.js';

describe('CreateJobInput', () => {
  const base = {
    inputSizeBytes: 1024,
    inputContentType: 'video/mp4',
    delivery: { mode: 'poll' },
  };

  it('accepts a valid poll-mode request and defaults chunkSeconds to 10', () => {
    const r = CreateJobInput.parse(base);
    expect(r.chunkSeconds).toBe(10);
  });

  it('rejects http callback URLs', () => {
    const r = CreateJobInput.safeParse({
      ...base,
      delivery: { mode: 'webhook', callbackUrl: 'http://example.com/hook' },
    });
    expect(r.success).toBe(false);
  });

  it('rejects oversize inputs', () => {
    const r = CreateJobInput.safeParse({ ...base, inputSizeBytes: 30 * 1024 ** 3 });
    expect(r.success).toBe(false);
  });

  it('rejects unsupported content types', () => {
    const r = CreateJobInput.safeParse({ ...base, inputContentType: 'application/octet-stream' });
    expect(r.success).toBe(false);
  });

  it('rejects chunkSeconds outside [5,60]', () => {
    expect(CreateJobInput.safeParse({ ...base, chunkSeconds: 1 }).success).toBe(false);
    expect(CreateJobInput.safeParse({ ...base, chunkSeconds: 120 }).success).toBe(false);
  });
});

describe('MergeEventSchema', () => {
  it('accepts a valid merge event', () => {
    expect(MergeEventSchema.parse({ id: 'abc', parts: 5 })).toEqual({ id: 'abc', parts: 5 });
  });
  it('rejects non-positive parts', () => {
    expect(MergeEventSchema.safeParse({ id: 'abc', parts: 0 }).success).toBe(false);
  });
});

describe('WebhookMessageSchema', () => {
  it('defaults attempt to 0', () => {
    expect(WebhookMessageSchema.parse({ jobId: 'x', event: 'job.completed' })).toEqual({
      jobId: 'x',
      event: 'job.completed',
      attempt: 0,
    });
  });
});
