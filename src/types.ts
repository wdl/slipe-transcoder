export type JobState =
  | 'awaiting_upload'
  | 'queued'
  | 'processing'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'canceled';

export interface JobRow {
  id: string;
  apiKeyId?: string;
  state: JobState;
  chunkSec: number;
  durationSec?: number;
  audio_todo?: number;
  audio_done_set?: Set<number>;
  video_todo?: number;
  video_done_set?: Set<number>;
  callbackUrl?: string;
  callbackToken?: string;
  signingSecret?: string;
  inputContentType?: string;
  inputSizeBytes?: number;
  inputFilename?: string;
  metadata?: Record<string, string>;
  downloadSize?: number;
  failureMessage?: string;
  cancelRequestedAt?: string;
  mergeStartedAt?: string;
  createdAt: string;
  updatedAt?: string;
  completedAt?: string;
  ttl: number;
}

export interface ConverterEvent {
  id: string;
  bucket: string;
  key: string;
  part?: number;
}

export interface MergeEvent {
  id: string;
  parts: number;
}

export interface WebhookQueueMessage {
  jobId: string;
  event: 'job.completed' | 'job.failed';
  attempt: number;
}
