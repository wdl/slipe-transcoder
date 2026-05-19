#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';

import { TranscoderStack } from '../lib/transcoder-stack.js';

const app = new App();
const stage = app.node.tryGetContext('stage') ?? process.env.STAGE ?? 'dev';

const stack = new TranscoderStack(app, `SlipeTranscoder-${stage}`, {
  stage,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});

Tags.of(stack).add('Service', 'slipe-transcoder');
Tags.of(stack).add('Stage', stage);
Tags.of(stack).add('ManagedBy', 'cdk');
