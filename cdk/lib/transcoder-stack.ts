import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';

import { ApiConstruct } from './api-construct.js';
import { ComputeConstruct } from './compute-construct.js';
import { DataConstruct } from './data-construct.js';
import { ObservabilityConstruct } from './observability-construct.js';
import { StorageConstruct } from './storage-construct.js';

export interface TranscoderStackProps extends StackProps {
  stage: string;
  outputTtlDays?: number;
  publicBase?: string;
}

export class TranscoderStack extends Stack {
  constructor(scope: Construct, id: string, props: TranscoderStackProps) {
    super(scope, id, props);

    const key = new kms.Key(this, 'Cmk', {
      alias: `alias/slipe-transcoder-${props.stage}`,
      enableKeyRotation: true,
      pendingWindow: Duration.days(7),
      description: 'CMK for slipe-transcoder buckets, tables, and queues',
    });

    const storage = new StorageConstruct(this, 'Storage', {
      key,
      outputTtlDays: props.outputTtlDays ?? 7,
    });

    const data = new DataConstruct(this, 'Data', { key });

    const compute = new ComputeConstruct(this, 'Compute', {
      key,
      storage,
      data,
      ...(props.publicBase !== undefined ? { publicBase: props.publicBase } : {}),
    });

    new ApiConstruct(this, 'Api', {
      apiFn: compute.apiFn,
      stage: props.stage,
    });

    new ObservabilityConstruct(this, 'Observability', {
      fns: compute.allFns,
      dlq: data.dlq,
      webhookDlq: data.webhookDlq,
      stage: props.stage,
    });
  }
}
