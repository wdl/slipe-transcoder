import 'aws-sdk-client-mock-vitest';

process.env.AWS_REGION = 'us-east-1';
process.env.JOBS_TABLE = 'test-jobs';
process.env.QUEUE_BUCKET = 'test-queue';
process.env.TEMP_BUCKET = 'test-temp';
process.env.OUTPUT_BUCKET = 'test-output';
process.env.AUDIO_FN = 'test-audio-fn';
process.env.VIDEO_FN = 'test-video-fn';
process.env.MERGE_FN = 'test-merge-fn';
process.env.WEBHOOK_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/000000000000/test-webhook';
process.env.PUBLIC_BASE = 'https://api.test';
process.env.LOG_LEVEL = 'ERROR';
process.env.DEFAULT_CHUNK_SECONDS = '10';
