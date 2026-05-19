import { describe, expect, it } from 'vitest';

import { UnsafeUrlError, assertSafeUrl } from '../../src/lib/url-guard.js';

describe('assertSafeUrl', () => {
  it('rejects http', async () => {
    await expect(assertSafeUrl('http://example.com')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects literal RFC1918 IP', async () => {
    await expect(assertSafeUrl('https://10.0.0.1/x')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl('https://192.168.1.1/x')).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl('https://172.16.0.1/x')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects literal loopback', async () => {
    await expect(assertSafeUrl('https://127.0.0.1/x')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects link-local 169.254', async () => {
    await expect(assertSafeUrl('https://169.254.169.254/latest/meta-data')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects non-443 port by default', async () => {
    await expect(assertSafeUrl('https://example.com:8080/x')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('rejects ipv6 loopback', async () => {
    await expect(assertSafeUrl('https://[::1]/x')).rejects.toBeInstanceOf(UnsafeUrlError);
  });

  it('honours allowedHosts allowlist', async () => {
    await expect(
      assertSafeUrl('https://example.com/x', { allowedHosts: ['other.com'] }),
    ).rejects.toBeInstanceOf(UnsafeUrlError);
  });
});
