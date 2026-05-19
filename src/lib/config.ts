import { z } from 'zod';

const EnvSchema = z.object({
  AWS_REGION: z.string().default('us-east-1'),

  JOBS_TABLE: z.string().min(1),

  QUEUE_BUCKET: z.string().min(1),
  TEMP_BUCKET: z.string().min(1),
  OUTPUT_BUCKET: z.string().min(1),

  AUDIO_FN: z.string().optional(),
  VIDEO_FN: z.string().optional(),
  MERGE_FN: z.string().optional(),

  WEBHOOK_QUEUE_URL: z.string().url().optional(),

  PUBLIC_BASE: z.string().url().optional(),

  FFMPEG_PATH: z.string().default('/usr/local/bin/ffmpeg'),
  FFPROBE_PATH: z.string().default('/usr/local/bin/ffprobe'),

  LOG_LEVEL: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),

  DEFAULT_CHUNK_SECONDS: z.coerce.number().int().min(5).max(60).default(10),
  MAX_INPUT_BYTES: z.coerce.number().int().positive().default(20 * 1024 ** 3),
  OUTPUT_TTL_DAYS: z.coerce.number().int().positive().default(7),
});

export type Config = z.infer<typeof EnvSchema>;

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  cached = parsed.data;
  return cached;
}

export const config = new Proxy({} as Config, {
  get(_, prop) {
    return loadConfig()[prop as keyof Config];
  },
});
