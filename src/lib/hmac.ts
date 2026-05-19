import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function signWebhook(secret: string, timestampSec: number, rawBody: string): string {
  const payload = `${timestampSec}.${rawBody}`;
  const mac = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `v1=${mac}`;
}

export function verifyWebhook(
  secret: string,
  timestampSec: number,
  rawBody: string,
  signatureHeader: string,
  toleranceSec = 300,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestampSec) > toleranceSec) return false;

  const expected = signWebhook(secret, timestampSec, rawBody);
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
