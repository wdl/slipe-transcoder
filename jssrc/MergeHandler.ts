import child_process = require('child_process');

import AWS = require('aws-sdk');

import fs = require('fs');

import _ from 'lodash';

fs.copyFileSync('./bin/ffmpeg', '/tmp/ffmpeg');
fs.copyFileSync('./bin/ffprobe', '/tmp/ffprobe');

fs.chmodSync('/tmp/ffmpeg', '755');
fs.chmodSync('/tmp/ffprobe', '755');

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

  console.log(fs.readFileSync('/tmp/list.txt', 'utf-8'));

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

  const r = child_process.spawnSync('/tmp/ffmpeg', [
    '-y', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-f', 'concat', '-safe', '0', '-i', '/tmp/list.txt', '-i', audioUrl, '-c', 'copy', '/tmp/temp.mp4',
  ]);

  console.log(r.stderr.toString());

  await s3.upload({
    Bucket: process.env.OUTPUT_BUCKET!,
    Key: `${id}.mp4`,
    Body: fs.createReadStream('/tmp/temp.mp4'),
  }).promise();

  return {
    statusCode: 200,
    body: JSON.stringify(event),
  };
}
