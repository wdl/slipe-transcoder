import { CfnOutput, Duration } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface ApiConstructProps {
  apiFn: lambda.IFunction;
  stage: string;
}

export class ApiConstruct extends Construct {
  readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiConstructProps) {
    super(scope, id);

    const api = new apigw.RestApi(this, 'Rest', {
      restApiName: `slipe-transcoder-${props.stage}`,
      deployOptions: {
        stageName: 'v1',
        tracingEnabled: true,
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
        accessLogDestination: undefined,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['content-type', 'x-api-key', 'authorization'],
      },
    });
    this.api = api;

    const integration = new apigw.LambdaIntegration(props.apiFn, { proxy: true });

    const v1 = api.root.addResource('v1');
    const healthz = v1.addResource('healthz');
    healthz.addMethod('GET', integration, { apiKeyRequired: false });

    const jobs = v1.addResource('jobs');
    jobs.addMethod('POST', integration, {
      apiKeyRequired: true,
    });

    const jobId = jobs.addResource('{id}');
    jobId.addMethod('GET', integration, { apiKeyRequired: true });

    const download = jobId.addResource('download');
    download.addMethod('GET', integration, { apiKeyRequired: true });

    const cancel = jobId.addResource('cancel');
    cancel.addMethod('POST', integration, { apiKeyRequired: true });

    const usagePlan = api.addUsagePlan('DefaultUsagePlan', {
      name: `slipe-default-${props.stage}`,
      throttle: { rateLimit: 10, burstLimit: 20 },
      quota: { limit: 10_000, period: apigw.Period.DAY },
    });
    usagePlan.addApiStage({ stage: api.deploymentStage });

    const defaultKey = api.addApiKey('DefaultKey', {
      apiKeyName: `slipe-default-${props.stage}`,
      description: 'Default API key. Rotate via console after first deploy.',
    });
    usagePlan.addApiKey(defaultKey);

    new CfnOutput(this, 'ApiUrl', { value: api.url ?? 'unknown' });
    new CfnOutput(this, 'ApiId', { value: api.restApiId });
    new CfnOutput(this, 'UsagePlanId', { value: usagePlan.usagePlanId });
    new CfnOutput(this, 'DefaultApiKeyId', { value: defaultKey.keyId });

    // Method-level throttling overrides via stage-level method settings
    const stage = api.deploymentStage as apigw.Stage;
    stage.node.addDependency(usagePlan);

    // Increase visibility of fine-grained limits
    void Duration; // keep import even if not explicitly used elsewhere here
  }
}
