import { Duration } from 'aws-cdk-lib';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface ObservabilityConstructProps {
  fns: lambda.IFunction[];
  dlq: sqs.IQueue;
  webhookDlq: sqs.IQueue;
  stage: string;
}

export class ObservabilityConstruct extends Construct {
  readonly alarmTopic: sns.ITopic;
  readonly dashboard: cw.Dashboard;

  constructor(scope: Construct, id: string, props: ObservabilityConstructProps) {
    super(scope, id);

    this.alarmTopic = new sns.Topic(this, 'Alarms', {
      displayName: `slipe-transcoder-${props.stage}-alarms`,
    });
    const action = new cwActions.SnsAction(this.alarmTopic);

    const lambdaWidgets: cw.IWidget[] = [];

    for (const fn of props.fns) {
      const errAlarm = new cw.Alarm(this, `${fn.node.id}ErrAlarm`, {
        metric: fn.metricErrors({ period: Duration.minutes(5), statistic: 'Sum' }),
        evaluationPeriods: 1,
        threshold: 3,
        comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
      });
      errAlarm.addAlarmAction(action);
      errAlarm.addOkAction(action);

      lambdaWidgets.push(
        new cw.GraphWidget({
          title: fn.node.id,
          left: [
            fn.metricInvocations({ period: Duration.minutes(5) }),
            fn.metricErrors({ period: Duration.minutes(5) }),
          ],
          right: [fn.metricDuration({ statistic: 'p99', period: Duration.minutes(5) })],
          width: 12,
          height: 6,
        }),
      );
    }

    const dlqDepthAlarm = new cw.Alarm(this, 'DlqDepthAlarm', {
      metric: props.dlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'Maximum',
      }),
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    dlqDepthAlarm.addAlarmAction(action);

    const webhookDlqAlarm = new cw.Alarm(this, 'WebhookDlqDepthAlarm', {
      metric: props.webhookDlq.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: 'Maximum',
      }),
      evaluationPeriods: 1,
      threshold: 1,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    webhookDlqAlarm.addAlarmAction(action);

    const customMetrics = (name: string) =>
      new cw.Metric({
        namespace: 'Slipe/Transcoder',
        metricName: name,
        statistic: 'Sum',
        period: Duration.minutes(5),
      });

    this.dashboard = new cw.Dashboard(this, 'Dashboard', {
      dashboardName: `slipe-transcoder-${props.stage}`,
      widgets: [
        [
          new cw.GraphWidget({
            title: 'Job throughput',
            left: [customMetrics('JobCreated'), customMetrics('JobsCompleted'), customMetrics('MergeFailures')],
            width: 24,
            height: 6,
          }),
        ],
        [
          new cw.GraphWidget({
            title: 'Chunk metrics',
            left: [customMetrics('ChunksDispatched'), customMetrics('AudioChunkSuccess'), customMetrics('VideoChunkSuccess')],
            right: [customMetrics('AudioChunkFailures'), customMetrics('VideoChunkFailures')],
            width: 24,
            height: 6,
          }),
        ],
        [
          new cw.GraphWidget({
            title: 'Webhook delivery',
            left: [customMetrics('WebhookDelivered'), customMetrics('WebhookTransientFailure'), customMetrics('WebhookPermanentFailure'), customMetrics('WebhookExhausted')],
            width: 24,
            height: 6,
          }),
        ],
        lambdaWidgets.slice(0, 2),
        lambdaWidgets.slice(2, 4),
        lambdaWidgets.slice(4, 6),
        lambdaWidgets.slice(6, 8),
      ],
    });
  }
}
