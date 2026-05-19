import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

export interface StorageConstructProps {
  key: kms.IKey;
  outputTtlDays: number;
}

export class StorageConstruct extends Construct {
  readonly queueBucket: s3.Bucket;
  readonly tempBucket: s3.Bucket;
  readonly outputBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: StorageConstructProps) {
    super(scope, id);

    const common = {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: props.key,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      versioned: false,
    };

    this.queueBucket = new s3.Bucket(this, 'Queue', {
      ...common,
      lifecycleRules: [
        {
          expiration: Duration.hours(24),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.POST],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    this.tempBucket = new s3.Bucket(this, 'Temp', {
      ...common,
      lifecycleRules: [
        {
          expiration: Duration.hours(24),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });

    this.outputBucket = new s3.Bucket(this, 'Output', {
      ...common,
      lifecycleRules: [
        {
          expiration: Duration.days(props.outputTtlDays),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
    });
  }
}
