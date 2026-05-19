import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

import { config } from './config.js';
import { logger } from './powertools.js';

export interface SpawnedFfmpeg {
  stdout: Readable;
  done: Promise<number>;
}

const DEFAULT_FLAGS = ['-hide_banner', '-loglevel', 'warning'];
const PROTOCOL_WHITELIST = ['-protocol_whitelist', 'pipe,file,http,https,tcp,tls,crypto'];

function tail(buf: Buffer, max = 4096): string {
  const s = buf.toString('utf8');
  return s.length > max ? s.slice(-max) : s;
}

export function spawnFfmpeg(args: ReadonlyArray<string>): SpawnedFfmpeg {
  const p = spawn(config.FFMPEG_PATH, [...DEFAULT_FLAGS, ...PROTOCOL_WHITELIST, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stderrChunks: Buffer[] = [];
  p.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

  const done = new Promise<number>((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => {
      const stderr = tail(Buffer.concat(stderrChunks));
      if (code !== 0) {
        logger.error('ffmpeg non-zero exit', { code, stderr });
      } else if (stderr) {
        logger.debug('ffmpeg stderr', { stderr });
      }
      resolve(code ?? -1);
    });
  });

  if (!p.stdout) throw new Error('ffmpeg stdout is null');
  return { stdout: p.stdout, done };
}

export async function ffprobeDuration(url: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const p = spawn(config.FFPROBE_PATH, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      ...PROTOCOL_WHITELIST,
      url,
    ]);

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    p.stdout.on('data', (c: Buffer) => outChunks.push(c));
    p.stderr.on('data', (c: Buffer) => errChunks.push(c));

    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe exited ${code}: ${tail(Buffer.concat(errChunks))}`));
      }
      try {
        const parsed = JSON.parse(Buffer.concat(outChunks).toString('utf8')) as {
          format?: { duration?: string | number };
        };
        const d = Number(parsed.format?.duration);
        if (!Number.isFinite(d) || d <= 0) {
          return reject(new Error('ffprobe returned invalid duration'));
        }
        resolve(d);
      } catch (e) {
        reject(e);
      }
    });
  });
}

export function spawnMerge(listPath: string, audioUrl: string): SpawnedFfmpeg {
  const concat = spawn(
    config.FFMPEG_PATH,
    [
      ...DEFAULT_FLAGS,
      ...PROTOCOL_WHITELIST,
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c', 'copy',
      '-f', 'mpegts',
      '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const mux = spawn(
    config.FFMPEG_PATH,
    [
      ...DEFAULT_FLAGS,
      ...PROTOCOL_WHITELIST,
      '-y',
      '-i', 'pipe:0',
      '-i', audioUrl,
      '-c', 'copy',
      '-f', 'mp4',
      '-bsf:a', 'aac_adtstoasc',
      '-movflags', 'frag_keyframe+empty_moov',
      '-',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  if (!concat.stdout || !mux.stdin || !mux.stdout) {
    throw new Error('failed to wire ffmpeg merge pipeline');
  }
  concat.stdout.pipe(mux.stdin);

  const errChunks: { name: string; chunks: Buffer[] } = { name: 'merge', chunks: [] };
  concat.stderr.on('data', (c: Buffer) => errChunks.chunks.push(c));
  mux.stderr.on('data', (c: Buffer) => errChunks.chunks.push(c));

  const done = Promise.all([
    new Promise<number>((res, rej) => {
      concat.on('error', rej);
      concat.on('close', (c) => res(c ?? -1));
    }),
    new Promise<number>((res, rej) => {
      mux.on('error', rej);
      mux.on('close', (c) => res(c ?? -1));
    }),
  ]).then(([a, b]) => {
    if (a !== 0 || b !== 0) {
      logger.error('ffmpeg merge failed', { concatCode: a, muxCode: b, stderr: tail(Buffer.concat(errChunks.chunks)) });
    }
    return a !== 0 ? a : b;
  });

  return { stdout: mux.stdout, done };
}

export function secondsToHms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
