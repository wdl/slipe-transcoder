import child_process = require('child_process');

import AWS = require('aws-sdk');

import fs = require('fs');

import _ from 'lodash';

const s3 = new AWS.S3();

export const invoke = async (event: any, context: any) => {
  const { id, video_done: parts } = event;

  const list = await Promise.all(_.range(parts).map(async i => {
    const url = await new Promise<string>((resolve, reject) => {
      s3.getSignedUrl('getObject', {
        Bucket: process.env.TEMP_BUCKET!,
        Key: `${id}/${i.toString().padStart(4, '0')}.ts`,
      }, (e, r) => {
        if (e) {
          reject(e);
        } else {
          resolve(r);
        }
      });
    });

    return `file '${url}'`;
  }));

  fs.writeFileSync('/tmp/list.txt', list.join('\n'));

  const audioUrl = await new Promise<string>((resolve, reject) => {
    s3.getSignedUrl('getObject', {
      Bucket: process.env.TEMP_BUCKET!,
      Key: `${id}/audio.aac`,
    }, (e, r) => {
      if (e) {
        reject(e);
      } else {
        resolve(r);
      }
    });
  });

  const r = child_process.spawn('/bin/bash', ['./bin/merge.sh', audioUrl], {
    stdio: [
      0,
      "pipe",
      'pipe',
    ]
  });

  await s3.upload({
    Bucket: process.env.OUTPUT_BUCKET!,
    Key: `${id}.mp4`,
    Body: r.stdout!,
    ContentType: 'video/mp4',
  }).promise();

  return {};
}
