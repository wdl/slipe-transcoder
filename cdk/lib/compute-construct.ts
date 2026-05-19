import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {
  DynamoEventSource,
  S3EventSourceV2,
  SqsEventSource,
} from 'aws-cdk-lib/aws-lambda-event-sources';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

import type { DataConstruct } from './data-construct.js';
import type { StorageConstruct } from './storage-construct.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

export interface ComputeConstructProps {
  key: kms.IKey;
  storage: StorageConstruct;
  data: DataConstruct;
  publicBase?: string;
}

export class ComputeConstruct extends Construct {
  readonly apiFn: lambda.DockerImageFunction;
  readonly queueFn: lambda.DockerImageFunction;
  readonly audioFn: lambda.DockerImageFunction;
  readonly videoFn: lambda.DockerImageFunction;
  readonly streamFn: lambda.DockerImageFunction;
  readonly mergeFn: lambda.DockerImageFunction;
  readonly webhookFn: lambda.DockerImageFunction;
  readonly allFns: lambda.DockerImageFunction[];

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);

    const { storage, data, key } = props;

    const sharedEnv: Record<string, string> = {
      JOBS_TABLE: data.jobsTable.tableName,
      QUEUE_BUCKET: storage.queueBucket.bucketName,
      TEMP_BUCKET: storage.tempBucket.bucketName,
      OUTPUT_BUCKET: storage.outputBucket.bucketName,
      WEBHOOK_QUEUE_URL: data.webhookQueue.queueUrl,
      LOG_LEVEL: 'INFO',
      POWERTOOLS_SERVICE_NAME: 'slipe-transcoder',
      POWERTOOLS_METRICS_NAMESPACE: 'Slipe/Transcoder',
      FFMPEG_PATH: '/usr/local/bin/ffmpeg',
      FFPROBE_PATH: '/usr/local/bin/ffprobe',
      ...(props.publicBase ? { PUBLIC_BASE: props.publicBase } : {}),
    };

    const imageAssetPath = REPO_ROOT;

    const makeFn = (
      name: string,
      cmd: string,
      cfg: {
        memoryMB: number;
        timeoutSec: number;
        reservedConcurrency?: number;
        dlq?: sqs.IQueue;
        extraEnv?: Record<string, string>;
      },
    ): lambda.DockerImageFunction => {
      const functionName = `${this.node.addr.slice(0, 10)}-${name}`.toLowerCase();
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        logGroupName: `/aws/lambda/${functionName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      });

      const fn = new lambda.DockerImageFunction(this, name, {
        functionName,
        code: lambda.DockerImageCode.fromImageAsset(imageAssetPath, {
          file: 'docker/Dockerfile',
          cmd: [cmd],
        }),
        architecture: lambda.Architecture.ARM_64,
        memorySize: cfg.memoryMB,
        timeout: Duration.seconds(cfg.timeoutSec),
        tracing: lambda.Tracing.ACTIVE,
        logGroup,
        environment: { ...sharedEnv, ...(cfg.extraEnv ?? {}) },
        ...(cfg.reservedConcurrency !== undefined
          ? { reservedConcurrentExecutions: cfg.reservedConcurrency }
          : {}),
        ...(cfg.dlq ? { deadLetterQueue: cfg.dlq, deadLetterQueueEnabled: true } : {}),
        retryAttempts: cfg.dlq ? 2 : 0,
        ...(cfg.dlq ? { onFailure: new destinations.SqsDestination(cfg.dlq) } : {}),
      });
      key.grantEncryptDecrypt(fn);
      return fn;
    };

    this.apiFn = makeFn('ApiFn', 'dist/handlers/api.handler', {
      memoryMB: 512,
      timeoutSec: 30,
      reservedConcurrency: 100,
    });

    this.queueFn = makeFn('QueueFn', 'dist/handlers/queue.handler', {
      memoryMB: 1024,
      timeoutSec: 60,
      reservedConcurrency: 50,
      dlq: data.dlq,
    });

    this.audioFn = makeFn('AudioFn', 'dist/handlers/audio-converter.handler', {
      memoryMB: 2048,
      timeoutSec: 400,
      reservedConcurrency: 200,
      dlq: data.dlq,
    });

    this.videoFn = makeFn('VideoFn', 'dist/handlers/video-converter.handler', {
      memoryMB: 1024,
      timeoutSec: 200,
      reservedConcurrency: 500,
      dlq: data.dlq,
    });

    this.streamFn = makeFn('StreamFn', 'dist/handlers/stream.handler', {
      memoryMB: 256,
      timeoutSec: 30,
      reservedConcurrency: 10,
      dlq: data.dlq,
    });

    this.mergeFn = makeFn('MergeFn', 'dist/handlers/merge.handler', {
      memoryMB: 2048,
      timeoutSec: 300,
      reservedConcurrency: 50,
      dlq: data.dlq,
    });

    this.webhookFn = makeFn('WebhookFn', 'dist/handlers/webhook-dispatcher.handler', {
      memoryMB: 256,
      timeoutSec: 30,
      reservedConcurrency: 20,
      dlq: data.webhookDlq,
    });

    this.allFns = [
      this.apiFn,
      this.queueFn,
      this.audioFn,
      this.videoFn,
      this.streamFn,
      this.mergeFn,
      this.webhookFn,
    ];

    // ----- wire env vars that reference fn ARNs -----
    this.queueFn.addEnvironment('AUDIO_FN', this.audioFn.functionName);
    this.queueFn.addEnvironment('VIDEO_FN', this.videoFn.functionName);
    this.streamFn.addEnvironment('MERGE_FN', this.mergeFn.functionName);

    // ----- IAM grants (least privilege) -----
    data.jobsTable.grantReadWriteData(this.apiFn);
    storage.queueBucket.grantPut(this.apiFn);

    storage.queueBucket.grantRead(this.queueFn);
    data.jobsTable.grantReadWriteData(this.queueFn);
    this.audioFn.grantInvoke(this.queueFn);
    this.videoFn.grantInvoke(this.queueFn);

    storage.queueBucket.grantRead(this.audioFn);
    storage.tempBucket.grantPut(this.audioFn);
    data.jobsTable.grantReadWriteData(this.audioFn);

    storage.queueBucket.grantRead(this.videoFn);
    storage.tempBucket.grantPut(this.videoFn);
    data.jobsTable.grantReadWriteData(this.videoFn);

    this.mergeFn.grantInvoke(this.streamFn);

    storage.tempBucket.grantRead(this.mergeFn);
    storage.outputBucket.grantReadWrite(this.mergeFn);
    data.jobsTable.grantReadWriteData(this.mergeFn);
    data.webhookQueue.grantSendMessages(this.mergeFn);

    data.jobsTable.grantReadData(this.webhookFn);
    storage.outputBucket.grantRead(this.webhookFn);
    data.webhookQueue.grantConsumeMessages(this.webhookFn);
    data.webhookQueue.grantSendMessages(this.webhookFn);

    storage.outputBucket.grantRead(this.apiFn);

    // ----- Event sources -----
    this.queueFn.addEventSource(
      new S3EventSourceV2(storage.queueBucket, {
        events: [s3.EventType.OBJECT_CREATED],
      }),
    );

    this.streamFn.addEventSource(
      new DynamoEventSource(data.jobsTable as dynamodb.Table, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        maxBatchingWindow: Duration.seconds(1),
        bisectBatchOnError: true,
        retryAttempts: 3,
        reportBatchItemFailures: true,
        filters: [
          lambda.FilterCriteria.filter({
            eventName: lambda.FilterRule.isEqual('MODIFY'),
          }),
        ],
      }),
    );

    this.webhookFn.addEventSource(
      new SqsEventSource(data.webhookQueue, {
        batchSize: 5,
        maxConcurrency: 10,
        reportBatchItemFailures: true,
      }),
    );

    // ----- KMS access -----
    for (const fn of this.allFns) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ['xray:PutTraceSegments', 'xray:PutTelemetryRecords'],
          resources: ['*'],
        }),
      );
    }
  }
}
