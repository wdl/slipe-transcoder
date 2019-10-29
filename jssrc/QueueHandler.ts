import child_process = require('child_process');

import AWS = require('aws-sdk');

import fs = require('fs');

import uuid from 'uuid';

import _ from 'lodash';

fs.copyFileSync('./bin/ffmpeg', '/tmp/ffmpeg');
fs.copyFileSync('./bin/ffprobe', '/tmp/ffprobe');

fs.chmodSync('/tmp/ffmpeg', '755');
fs.chmodSync('/tmp/ffprobe', '755');

const s3 = new AWS.S3();
const ddb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

export const invoke = async (event: any, context: any) => {
  for (let rc of event.Records) {
    const url = await new Promise<string>((resolve, reject) => {
      s3.getSignedUrl('getObject', {
        Bucket: rc.s3.bucket.name,
        Key: rc.s3.object.key,
      }, (e, r) => {
        if (e) {
          reject(e);
        } else {
          resolve(r);
        }
      });
    });
  
    const r = child_process.spawnSync("/tmp/ffprobe", [
      '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', url,
    ], {
      encoding: 'utf-8',
    });
  
    // console.log(JSON.stringify(event));
    console.log(r);
    console.log(r.stdout);
    console.log(r.stderr);

    const data = JSON.parse(r.stdout);

    const duration = Number(data.format.duration);

    const id = uuid.v4();

    const numParts = Math.ceil(duration / 10);

    await ddb.put({
      TableName: process.env.TABLE_NAME!,
      Item: {
        id,
        key: rc.s3.object.key,
        audio_todo: 1,
        audio_done: 0,
        video_todo: numParts,
        video_done: 0,
      },
    }).promise();

    await lambda.invoke({
      FunctionName: process.env.LAMBDA_AUDIO_CONVERTER!,
      Payload: JSON.stringify({
        id,
        bucket: rc.s3.bucket.name,
        key: rc.s3.object.key,
      }),
      InvocationType: 'Event',
    }).promise();

    await Promise.all(_.range(numParts).map(async i => {
      await lambda.invoke({
        FunctionName: process.env.LAMBDA_VIDEO_CONVERTER!,
        Payload: JSON.stringify({
          id,
          bucket: rc.s3.bucket.name,
          key: rc.s3.object.key,
          part: i,
        }),
        InvocationType: 'Event',
      }).promise();
    }));
  }

  return {
    statusCode: 200,
    body: JSON.stringify(event),
  };
}
