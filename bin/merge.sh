#!/bin/bash

./bin/ffmpeg -y -protocol_whitelist pipe,file,http,https,tcp,tls,crypto -f concat -safe 0 -i /tmp/list.txt -c copy -f mpegts - |
  ./bin/ffmpeg -y -protocol_whitelist pipe,file,http,https,tcp,tls,crypto -i - -i "$1" -c copy -f mp4 -bsf:a 'aac_adtstoasc' -movflags frag_keyframe+empty_moov -
