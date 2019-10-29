#!/bin/bash

npm install && npm run build || exit 1
serverless deploy --region ap-northeast-1 -v || exit 1
