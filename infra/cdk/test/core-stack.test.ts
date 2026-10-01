import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ContextiaCoreStack } from '../src/core-stack.js';
import { createContextiaApp } from '../src/app.js';

const target = { account: '634512763705', region: 'ap-northeast-1', buildId: 'abc123' } as const;

describe('Phase 0 infrastructure', () => {
  it.each(['dev', 'prod'] as const)('isolates the %s health API and logs', (stage) => {
    const stack = new ContextiaCoreStack(new App(), { ...target, stage });
    const template = Template.fromStack(stack);
    expect(stack.stackName).toBe(`contextia-${stage}-core`);
    expect(stack.account).toBe('634512763705');
    expect(stack.region).toBe('ap-northeast-1');
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `contextia-${stage}-api`, Runtime: 'nodejs24.x', Timeout: 20,
      Environment: { Variables: Match.objectLike({ CONTEXTIA_STAGE: stage, BUILD_ID: 'abc123' }) },
      LoggingConfig: Match.objectLike({ LogFormat: 'JSON' })
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: `/aws/lambda/contextia-${stage}-api`, RetentionInDays: stage === 'dev' ? 7 : 30
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { Name: `contextia-${stage}-http-api`, ProtocolType: 'HTTP' });
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 1);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /health', AuthorizationType: 'NONE' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: Match.objectLike({ ThrottlingBurstLimit: 20, ThrottlingRateLimit: 10 })
    });
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: `contextia-${stage}-api-role`, ManagedPolicyArns: Match.absent()
    });
    template.resourceCountIs('AWS::IAM::Policy', 1);
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: Match.objectLike({ Statement: [Match.objectLike({
        Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        Resource: { 'Fn::GetAtt': [Match.anyValue(), 'Arn'] }
      })] })
    });
    template.hasOutput('Stage', { Value: stage });
    template.hasOutput('ApiBaseUrl', { Value: Match.anyValue() });
    template.resourceCountIs('AWS::DynamoDB::Table', 0);
    template.resourceCountIs('AWS::S3::Bucket', 0);
  });

  it.each(['dev', 'prod'])('creates only the explicitly selected %s stack', (stage) => {
    const app = createContextiaApp({ ...target, stage });
    expect(app.node.children.filter((child) => Stack.isStack(child)).map((child) => child.node.id)).toEqual([`contextia-${stage}-core`]);
  });

  it.each([
    { ...target },
    { ...target, stage: 'staging' },
    { ...target, stage: 'dev', account: '000000000000' },
    { ...target, stage: 'dev', region: 'us-east-1' }
  ])('rejects an invalid target before creating infrastructure', (options) => {
    expect(() => createContextiaApp(options)).toThrow();
  });
});
