#!/bin/bash

npm install && npm run build || exit 1
serverless deploy -v "$(aws configure get region)" || exit 1
