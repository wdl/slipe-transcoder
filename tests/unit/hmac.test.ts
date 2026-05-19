import { describe, expect, it } from 'vitest';

import { sha256, signWebhook, verifyWebhook } from '../../src/lib/hmac.js';

describe('hmac helpers', () => {
  it('sha256 produces stable hex digest', () => {
    expect(sha256('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('signs and verifies roundtrip', () => {
    const secret = 'topsecret';
    const ts = Math.floor(Date.now() / 1000);
    const body = '{"hello":"world"}';
    const sig = signWebhook(secret, ts, body);
    expect(sig.startsWith('v1=')).toBe(true);
    expect(verifyWebhook(secret, ts, body, sig)).toBe(true);
  });

  it('rejects mismatched body', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = signWebhook('s', ts, 'a');
    expect(verifyWebhook('s', ts, 'b', sig)).toBe(false);
  });

  it('rejects stale timestamp outside tolerance', () => {
    const ts = Math.floor(Date.now() / 1000) - 1000;
    const sig = signWebhook('s', ts, 'a');
    expect(verifyWebhook('s', ts, 'a', sig, 60)).toBe(false);
  });
});
