import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import type * as kms from 'aws-cdk-lib/aws-kms';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface DataConstructProps {
  key: kms.IKey;
}

export class DataConstruct extends Construct {
  readonly jobsTable: dynamodb.ITable;
  readonly dlq: sqs.IQueue;
  readonly webhookQueue: sqs.IQueue;
  readonly webhookDlq: sqs.IQueue;

  constructor(scope: Construct, id: string, props: DataConstructProps) {
    super(scope, id);

    const table = new dynamodb.TableV2(this, 'Jobs', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      dynamoStream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecovery: true,
      encryption: dynamodb.TableEncryptionV2.customerManagedKey(props.key),
      removalPolicy: RemovalPolicy.RETAIN,
      globalSecondaryIndexes: [
        {
          indexName: 'apiKeyId-state-index',
          partitionKey: { name: 'apiKeyId', type: dynamodb.AttributeType.STRING },
          sortKey: { name: 'state', type: dynamodb.AttributeType.STRING },
          projectionType: dynamodb.ProjectionType.KEYS_ONLY,
        },
      ],
    });
    this.jobsTable = table;

    this.dlq = new sqs.Queue(this, 'GeneralDlq', {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.key,
    });

    this.webhookDlq = new sqs.Queue(this, 'WebhookDlq', {
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.key,
    });

    this.webhookQueue = new sqs.Queue(this, 'Webhook', {
      visibilityTimeout: Duration.seconds(60),
      retentionPeriod: Duration.days(4),
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: props.key,
      deadLetterQueue: {
        queue: this.webhookDlq,
        maxReceiveCount: 6,
      },
    });
  }
}
