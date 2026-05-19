import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { tracer } from './powertools.js';

const region = process.env.AWS_REGION ?? 'us-east-1';

const rawDynamo = new DynamoDBClient({ region });

export const s3 = tracer.captureAWSv3Client(new S3Client({ region }));
export const ddb = tracer.captureAWSv3Client(
  DynamoDBDocumentClient.from(rawDynamo, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertClassInstanceToMap: true,
    },
  }),
);
export const lam = tracer.captureAWSv3Client(new LambdaClient({ region }));
export const sqs = tracer.captureAWSv3Client(new SQSClient({ region }));
