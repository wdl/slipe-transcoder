import child_process = require('child_process');

import AWS = require('aws-sdk');

import fs = require('fs');

import _ from 'lodash';

import Axios from 'axios';

const s3 = new AWS.S3();
const ddb = new AWS.DynamoDB.DocumentClient();

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
  }).promise();

  const url = s3.getSignedUrl('getObject', {
    Bucket: process.env.OUTPUT_BUCKET!,
    Key: `${id}.mp4`,
    Expires: 3600 * 24,
  });

  await ddb.delete({
    TableName: process.env.QUEUE_TABLE_NAME!,
    Key: {
      id,
    },
  }).promise();

  const req = await ddb.get({
    TableName: process.env.API_TABLE_NAME!,
    Key: {
      id: id,
    },
  }).promise();

  try {
    await Axios.post(req.Item!.callback, {
      token: req.Item!.token,
      url,
    });
  } catch (e) {

  }

  return {};
}
