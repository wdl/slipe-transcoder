import { describe, expect, it } from 'vitest';

import { ok, problem } from '../../src/lib/problem-details.js';

describe('problem-details', () => {
  it('emits application/problem+json with required fields', () => {
    const r = problem(400, 'validation-failed', 'bad input', [{ path: 'x', message: 'required' }]);
    expect(r.statusCode).toBe(400);
    expect(r.headers).toEqual({ 'content-type': 'application/problem+json' });
    const body = JSON.parse(r.body!);
    expect(body.status).toBe(400);
    expect(body.type).toMatch(/validation-failed$/);
    expect(body.errors).toHaveLength(1);
  });

  it('ok emits json with statusCode passthrough', () => {
    const r = ok(201, { hello: 'world' });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body!).hello).toBe('world');
  });
});
