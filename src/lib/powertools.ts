import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';
import { Tracer } from '@aws-lambda-powertools/tracer';

const SERVICE = 'slipe-transcoder';
const NAMESPACE = 'Slipe/Transcoder';

export const logger = new Logger({ serviceName: SERVICE });
export const metrics = new Metrics({ namespace: NAMESPACE, serviceName: SERVICE });
export const tracer = new Tracer({ serviceName: SERVICE });

export { MetricUnit };
