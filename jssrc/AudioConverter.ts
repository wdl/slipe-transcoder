import child_process = require('child_process');

import AWS = require('aws-sdk');

import fs = require('fs');

const s3 = new AWS.S3();
const ddb = new AWS.DynamoDB.DocumentClient();

export const invoke = async (event: any, context: any) => {
  const url = await new Promise<string>((resolve, reject) => {
    s3.getSignedUrl('getObject', {
      Bucket: event.bucket,
      Key: event.key,
    }, (e, r) => {
      if (e) {
        reject(e);
      } else {
        resolve(r);
      }
    });
  });

  const r = child_process.spawn('./bin/ffmpeg', [
    '-y', '-i', url, `-c:a`, `aac`, `-b:a`, `128000`, '-vn', '-f', 'adts', `-`,
  ]);

  await s3.upload({
    Bucket: process.env.BUCKET_NAME!,
    Key: `${event.id}/audio.aac`,
    Body: r.stdout!,
  }).promise();

  await ddb.update({
    TableName: process.env.TABLE_NAME!,
    Key: {
      id: event.id,
    },
    UpdateExpression: 'SET #audio_done = #audio_done + :one',
    ExpressionAttributeNames: {
      '#audio_done': 'audio_done',
    },
    ExpressionAttributeValues: {
      ':one': 1,
    },
  }).promise();

  return {};
}
