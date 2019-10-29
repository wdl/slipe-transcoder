import AWS = require('aws-sdk');

const s3 = new AWS.S3();
const ddb = new AWS.DynamoDB.DocumentClient();

import uuid from 'uuid';
import { PresignedPost } from 'aws-sdk/clients/s3';

export const invoke = async (event: any, context: any) => {
  const id = uuid.v4();

  const body = JSON.parse(event.body);

  await ddb.put({
    TableName: process.env.TABLE_NAME!,
    Item: {
      id,
      callback: body.callback,
      token: body.token,
    },
  }).promise();

  const r = await new Promise<PresignedPost>((resolve, reject) => {
    s3.createPresignedPost({
      Bucket: process.env.BUCKET_NAME!,
      Fields: {
        key: id,
      },
    }, (e, r) => {
      if (e) {
        reject(e);
      } else {
        resolve(r);
      }
    });
  });

  return {
    statusCode: 200,
    body: JSON.stringify(r),
  };
}