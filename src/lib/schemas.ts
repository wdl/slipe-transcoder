import { z } from 'zod';

const ALLOWED_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
  'video/mpeg',
] as const;

const httpsUrl = z
  .string()
  .url()
  .refine((u) => {
    try {
      return new URL(u).protocol === 'https:';
    } catch {
      return false;
    }
  }, { message: 'must be an https URL' });

export const MetadataSchema = z
  .record(z.string().max(64), z.string().max(512))
  .refine((m) => JSON.stringify(m).length <= 4096, { message: 'metadata exceeds 4KB' })
  .refine((m) => Object.keys(m).length <= 32, { message: 'metadata has more than 32 keys' });

export const DeliverySchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('webhook'),
    callbackUrl: httpsUrl,
    callbackToken: z.string().min(1).max(256).optional(),
  }),
  z.object({ mode: z.literal('poll') }),
]);

export const CreateJobInput = z.object({
  inputFilename: z.string().min(1).max(512).optional(),
  inputSizeBytes: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 ** 3),
  inputContentType: z.enum(ALLOWED_CONTENT_TYPES),
  chunkSeconds: z.number().int().min(5).max(60).default(10),
  delivery: DeliverySchema,
  metadata: MetadataSchema.optional(),
});

export type CreateJobInput = z.infer<typeof CreateJobInput>;

export const ConverterEventSchema = z.object({
  id: z.string().min(1),
  bucket: z.string().min(1),
  key: z.string().min(1),
  part: z.number().int().nonnegative().optional(),
});

export type ConverterEventInput = z.infer<typeof ConverterEventSchema>;

export const MergeEventSchema = z.object({
  id: z.string().min(1),
  parts: z.number().int().positive(),
});

export type MergeEventInput = z.infer<typeof MergeEventSchema>;

export const WebhookMessageSchema = z.object({
  jobId: z.string().min(1),
  event: z.enum(['job.completed', 'job.failed']),
  attempt: z.number().int().nonnegative().default(0),
});

export type WebhookMessageInput = z.infer<typeof WebhookMessageSchema>;

export const DownloadTtlSchema = z.coerce.number().int().min(60).max(86_400).default(300);

export const ALLOWED_INPUT_TYPES = ALLOWED_CONTENT_TYPES;
