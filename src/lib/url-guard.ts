import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

const PRIVATE_V4 = [
  { net: 0x0a000000, mask: 0xff000000 },        // 10.0.0.0/8
  { net: 0xac100000, mask: 0xfff00000 },        // 172.16.0.0/12
  { net: 0xc0a80000, mask: 0xffff0000 },        // 192.168.0.0/16
  { net: 0x7f000000, mask: 0xff000000 },        // 127.0.0.0/8
  { net: 0xa9fe0000, mask: 0xffff0000 },        // 169.254.0.0/16
  { net: 0x64400000, mask: 0xffc00000 },        // 100.64.0.0/10 (CGNAT)
  { net: 0x00000000, mask: 0xff000000 },        // 0.0.0.0/8
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`invalid ipv4: ${ip}`);
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return PRIVATE_V4.some(({ net, mask }) => ((n & mask) >>> 0) === net);
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::' || lower.startsWith('::ffff:')) {
    if (lower.startsWith('::ffff:')) {
      const v4 = lower.slice(7);
      if (isIP(v4) === 4) return isPrivateV4(v4);
    }
    return true;
  }
  if (lower.startsWith('fe80:') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('ff')) return true;
  return false;
}

export interface UrlGuardOptions {
  allowedHosts?: ReadonlyArray<string>;
  allowedPorts?: ReadonlyArray<number>;
}

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export async function assertSafeUrl(url: string, opts: UrlGuardOptions = {}): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeUrlError('invalid URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new UnsafeUrlError('only https:// is allowed');
  }

  const port = parsed.port ? Number(parsed.port) : 443;
  const allowedPorts = opts.allowedPorts ?? [443];
  if (!allowedPorts.includes(port)) {
    throw new UnsafeUrlError(`port ${port} is not in allowlist`);
  }

  if (opts.allowedHosts && !opts.allowedHosts.includes(parsed.hostname)) {
    throw new UnsafeUrlError(`host ${parsed.hostname} not in allowlist`);
  }

  const host = parsed.hostname;
  if (isIP(host)) {
    if (isIP(host) === 4 ? isPrivateV4(host) : isPrivateV6(host)) {
      throw new UnsafeUrlError('literal IP points at a private/reserved range');
    }
    return;
  }

  const records = await safeResolve(host);
  if (records.length === 0) {
    throw new UnsafeUrlError(`hostname ${host} did not resolve`);
  }
  for (const ip of records) {
    const family = isIP(ip);
    if (family === 4 && isPrivateV4(ip)) {
      throw new UnsafeUrlError(`hostname ${host} resolved to private IPv4 ${ip}`);
    }
    if (family === 6 && isPrivateV6(ip)) {
      throw new UnsafeUrlError(`hostname ${host} resolved to private IPv6 ${ip}`);
    }
  }
}

async function safeResolve(host: string): Promise<string[]> {
  const out: string[] = [];
  await Promise.allSettled([
    dns.resolve4(host).then((rs) => out.push(...rs)).catch(() => {}),
    dns.resolve6(host).then((rs) => out.push(...rs)).catch(() => {}),
  ]);
  return out;
}
