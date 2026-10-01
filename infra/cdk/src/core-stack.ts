import { CfnOutput, Duration, RemovalPolicy, Stack, Tags } from 'aws-cdk-lib';
import type { App, StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Runtime, LoggingFormat } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseDeploymentConfig } from '@contextia/config';
import type { DeploymentConfig } from '@contextia/config';

export class ContextiaCoreStack extends Stack {
  constructor(scope: App, config: DeploymentConfig, props: StackProps = {}) {
    const target = parseDeploymentConfig(config);
    const prefix = `contextia-${target.stage}`;
    super(scope, `${prefix}-core`, {
      ...props,
      stackName: `${prefix}-core`,
      env: { account: target.account, region: target.region }
    });

    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const logs = new LogGroup(this, 'ApiLogs', {
      logGroupName: `/aws/lambda/${prefix}-api`,
      retention: target.stage === 'dev' ? RetentionDays.ONE_WEEK : RetentionDays.ONE_MONTH,
      removalPolicy: target.stage === 'dev' ? RemovalPolicy.DESTROY : RemovalPolicy.RETAIN
    });
    const apiRole = new Role(this, 'ApiRole', {
      roleName: `${prefix}-api-role`,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com')
    });
    logs.grantWrite(apiRole);
    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      functionName: `${prefix}-api`,
      entry: join(root, 'apps/api/src/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_24_X,
      role: apiRole,
      timeout: Duration.seconds(20),
      memorySize: 256,
      logGroup: logs,
      loggingFormat: LoggingFormat.JSON,
      environment: { CONTEXTIA_STAGE: target.stage, BUILD_ID: target.buildId },
      depsLockFilePath: join(root, 'pnpm-lock.yaml'),
      projectRoot: root,
      bundling: { target: 'node24', format: OutputFormat.CJS, externalModules: [], sourceMap: true }
    });
    const api = new HttpApi(this, 'HttpApi', { apiName: `${prefix}-http-api` });
    api.addRoutes({ path: '/health', methods: [HttpMethod.GET], integration: new HttpLambdaIntegration('HealthIntegration', apiFunction) });
    const defaultStage = api.defaultStage?.node.defaultChild;
    if (defaultStage instanceof CfnStage) {
      defaultStage.defaultRouteSettings = { throttlingBurstLimit: 20, throttlingRateLimit: 10 };
    }
    new CfnOutput(this, 'ApiBaseUrl', { value: api.apiEndpoint });
    new CfnOutput(this, 'Stage', { value: target.stage });
    Tags.of(this).add('project', 'contextia');
    Tags.of(this).add('stage', target.stage);
  }
}
