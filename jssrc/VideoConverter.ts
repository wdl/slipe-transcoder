import child_process = require('child_process');

import AWS = require('aws-sdk');

import fs = require('fs');

fs.copyFileSync('./bin/ffmpeg', '/tmp/ffmpeg');
fs.copyFileSync('./bin/ffprobe', '/tmp/ffprobe');

fs.chmodSync('/tmp/ffmpeg', '755');
fs.chmodSync('/tmp/ffprobe', '755');

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

  const { part } = event;

  const mm = part % 60;
  const hh = Math.floor(part / 60);

  const r = child_process.spawnSync('/tmp/ffmpeg', [
    '-y', '-ss', `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}:00`, '-t', '00:01:00', '-i', url, `-an`, '-vcodec', 'libx264', `-bsf:v`, `h264_mp4toannexb`, `-f`, `mpegts`, `/tmp/temp.ts`,
  ]);

  console.log(r.stderr.toString());

  await s3.upload({
    Bucket: process.env.BUCKET_NAME!,
    Key: `${event.id}/${part.toString().padStart(4, '0')}.ts`,
    Body: fs.createReadStream('/tmp/temp.ts'),
  }).promise();

  await ddb.update({
    TableName: process.env.TABLE_NAME!,
    Key: {
      id: event.id,
    },
    UpdateExpression: 'SET #video_done = #video_done + :one',
    ExpressionAttributeNames: {
      '#video_done': 'video_done',
    },
    ExpressionAttributeValues: {
      ':one': 1,
    },
  }).promise();

  return {
    statusCode: 200,
    body: JSON.stringify(event),
  };
}
