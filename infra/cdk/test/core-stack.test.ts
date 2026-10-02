import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContextiaCoreStack } from '../src/core-stack.js';
import { createContextiaApp } from '../src/app.js';

const target = { account: '634512763705', region: 'ap-northeast-1', buildId: 'abc123' } as const;
const webAssetPath = mkdtempSync(join(tmpdir(), 'contextia-web-'));
mkdirSync(join(webAssetPath, 'assets'));
writeFileSync(join(webAssetPath, 'index.html'), '<!doctype html><title>test</title>');
writeFileSync(join(webAssetPath, 'assets', 'index-test.js'), 'console.log("test")');

const stages = ['dev', 'prod'] as const;
const templates = new Map(stages.map(stage => {
  const stack = new ContextiaCoreStack(new App(), { ...target, stage }, { webAssetPath });
  return [stage, { stack, template: Template.fromStack(stack) }] as const;
}));
function synth(stage: typeof stages[number]) {
  const entry = templates.get(stage);
  if (!entry) throw new Error('missing template');
  return entry;
}
const localOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

describe.each(stages)('%s core stack', (stage) => {
  const { stack, template } = synth(stage);
  const isDev = stage === 'dev';

  it('targets the approved account, Region and stage name', () => {
    expect(stack.stackName).toBe(`contextia-${stage}-core`);
    expect(stack.account).toBe('634512763705');
    expect(stack.region).toBe('ap-northeast-1');
    template.hasOutput('Stage', { Value: stage });
    for (const output of ['ApiBaseUrl', 'WebUrl', 'WebBucketName', 'WebDistributionId', 'UserPoolId', 'WebClientId', 'MobileClientId', 'HostedUiBaseUrl', 'TableName']) {
      template.hasOutput(output, { Value: Match.anyValue() });
    }
  });

  it('runs the API on Node.js 24 with JSON logs and client IDs for preview authorization', () => {
    template.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: `contextia-${stage}-api`, Runtime: 'nodejs24.x', Timeout: 20, MemorySize: 512,
      Environment: { Variables: Match.objectLike({ CONTEXTIA_STAGE: stage, BUILD_ID: 'abc123', WEB_CLIENT_ID: Match.anyValue(), MOBILE_CLIENT_ID: Match.anyValue(), TABLE_NAME: Match.anyValue(), BEDROCK_MODEL_ID: { Ref: 'BedrockModelId' }, CONVERSATION_TTL_SECONDS: '7200' }) },
      LoggingConfig: Match.objectLike({ LogFormat: 'JSON' })
    });
    template.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: `/aws/lambda/contextia-${stage}-api`, RetentionInDays: isDev ? 7 : 30 });
    template.hasResourceProperties('AWS::IAM::Role', { RoleName: `contextia-${stage}-api-role`, ManagedPolicyArns: Match.absent() });
  });

  it('protects evaluation with a Cognito JWT authorizer and keeps /health public', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      Name: `contextia-${stage}-http-api`, ProtocolType: 'HTTP',
      CorsConfiguration: Match.objectLike({
        AllowHeaders: ['authorization', 'content-type', 'accept', 'idempotency-key'],
        AllowMethods: Match.arrayWith(['PUT']),
        AllowOrigins: isDev ? Match.arrayWith(localOrigins) : [Match.anyValue()]
      })
    });
    template.resourceCountIs('AWS::ApiGatewayV2::Route', 7);
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /health', AuthorizationType: 'NONE' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /v1/context/evaluate', AuthorizationType: 'JWT', AuthorizerId: Match.anyValue() });
    for (const route of ['GET /v1/me', 'PUT /v1/me/preferences', 'GET /v1/recommendations', 'GET /v1/recommendations/{recommendationId}', 'POST /v1/recommendations/{recommendationId}/chat']) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: route, AuthorizationType: 'JWT', AuthorizerId: Match.anyValue() });
    }
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      Name: `contextia-${stage}-cognito`, AuthorizerType: 'JWT',
      JwtConfiguration: { Audience: [Match.anyValue(), Match.anyValue()], Issuer: Match.anyValue() }
    });
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: Match.objectLike({ ThrottlingBurstLimit: 20, ThrottlingRateLimit: 10 })
    });
  });

  it('creates an invite-only user pool with public PKCE clients', () => {
    template.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: `contextia-${stage}-users`, AdminCreateUserConfig: { AllowAdminCreateUserOnly: true }, UsernameAttributes: ['email']
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', { Domain: `contextia-${stage}-634512763705` });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: `contextia-${stage}-web`, GenerateSecret: false, AllowedOAuthFlows: ['code'], AllowedOAuthScopes: ['openid', 'email'],
      ExplicitAuthFlows: isDev ? Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH']) : Match.not(Match.arrayWith(['ALLOW_USER_PASSWORD_AUTH'])),
      CallbackURLs: isDev ? Match.arrayWith(localOrigins.map(origin => `${origin}/`)) : [Match.objectLike({ 'Fn::Join': Match.anyValue() })]
    });
    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: `contextia-${stage}-mobile`, GenerateSecret: false, AllowedOAuthFlows: ['code'], CallbackURLs: [`contextia-${stage}://auth/callback`]
    });
  });

  it('keeps localhost callbacks out of prod', () => {
    if (isDev) return;
    expect(JSON.stringify(template.toJSON())).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('stores state in an on-demand DynamoDB table with TTL', () => {
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      TableName: `contextia-${stage}-data`, BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: !isDev },
      DeletionProtectionEnabled: !isDev
    });
    template.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: isDev ? 'Delete' : 'Retain' });
  });

  it('serves the console from a private bucket through CloudFront OAC over HTTPS', () => {
    template.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
      OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
      WebsiteConfiguration: Match.absent()
    });
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: Match.objectLike({ Statement: Match.arrayWith([
        Match.objectLike({ Effect: 'Deny', Condition: { Bool: { 'aws:SecureTransport': 'false' } } }),
        Match.objectLike({ Effect: 'Allow', Principal: { Service: 'cloudfront.amazonaws.com' }, Action: 's3:GetObject' })
      ]) })
    });
    template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultRootObject: 'index.html',
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https', Compress: true }),
        CustomErrorResponses: [
          { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: '/index.html', ErrorCachingMinTTL: 0 },
          { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: '/index.html', ErrorCachingMinTTL: 0 }
        ]
      })
    });
  });

  it('deploys immutable assets and an uncached entry point with generated runtime config', () => {
    template.resourceCountIs('AWS::Lambda::LayerVersion', 2);
    for (const deployment of ['assets', 'entry']) {
      template.hasResourceProperties('AWS::Lambda::LayerVersion', {
        LayerName: `contextia-${stage}-core-web-${deployment}-aws-cli`
      });
    }
    template.resourceCountIs('Custom::CDKBucketDeployment', 2);
    template.hasResourceProperties('Custom::CDKBucketDeployment', { Prune: false, SystemMetadata: { 'cache-control': 'public, max-age=31536000, immutable' } });
    template.hasResourceProperties('Custom::CDKBucketDeployment', {
      Prune: false, SystemMetadata: { 'cache-control': 'no-cache' }, DistributionPaths: ['/', '/index.html', '/config.json'],
      SourceMarkers: [{}, Match.objectLike({})]
    });
  });

  it('grants no wildcard IAM actions', () => {
    for (const policy of Object.values(template.findResources('AWS::IAM::Policy'))) {
      const statements = (policy as { Properties: { PolicyDocument: { Statement: { Action: unknown }[] } } }).Properties.PolicyDocument.Statement;
      for (const statement of statements) expect([statement.Action].flat()).not.toContain('*');
    }
  });

  it('restricts runtime provider/model access to the stage table and explicit provider resources', () => {
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: { Statement: Match.arrayWith([
        Match.objectLike({ Action: ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:ConditionCheckItem'], Resource: Match.anyValue() }),
        Match.objectLike({ Action: ['geo-places:SearchNearby', 'geo-places:GetPlace', 'geo-places:Geocode'], Resource: Match.anyValue() }),
        Match.objectLike({ Action: 'geo-routes:CalculateRoutes', Resource: Match.anyValue() }),
        Match.objectLike({ Action: 'bedrock:InvokeModel', Resource: { Ref: 'BedrockModelResources' } })
      ]) }
    });
    template.hasParameter('BedrockModelResources', { Type: 'CommaDelimitedList', AllowedPattern: Match.anyValue(), Default: Match.absent() });
  });

  it('issues only a referrer-restricted, expiring map key and hides its lookup response from logs', () => {
    template.hasResource('AWS::Location::APIKey', { DeletionPolicy: 'Retain', Properties: Match.objectLike({
      KeyName: `contextia-${stage}-web-map`, NoExpiry: false, ExpireTime: { Ref: 'MapKeyExpireTime' }, ForceDelete: Match.absent(),
      Restrictions: { AllowActions: ['geo-maps:GetTile'], AllowResources: Match.anyValue(), AllowReferers: isDev ? Match.arrayWith(localOrigins.map(origin => `${origin}/*`)) : [Match.anyValue()] }
    }) });
    const lookup = Object.values(template.findResources('Custom::AWS'))[0];
    expect(JSON.stringify(lookup)).toContain('describeKey');
    expect(JSON.stringify(lookup)).toContain('logApiResponseData');
    expect(JSON.stringify(lookup)).toContain('false');
  });

  it('limits GitHub deployment to this repository and the stage-specific bootstrap roles', () => {
    const roles = template.findResources('AWS::IAM::Role', { Properties: { RoleName: isDev ? 'GitHubDevDeployRole' : 'GitHubProdDeployRole' } });
    const policy = JSON.stringify(Object.values(roles)[0]);
    expect(policy).toContain('sts:AssumeRoleWithWebIdentity');
    expect(policy).toContain(`repo:xe-pc23@208585459/Contextia@1395735696:environment:${stage}`);
    expect(policy).not.toContain('feature/*');
    expect(policy).not.toContain('StringLike');
    expect(policy).not.toContain(`:environment:${isDev ? 'prod' : 'dev'}`);
    template.hasResourceProperties('AWS::IAM::Policy', { PolicyDocument: { Statement: Match.arrayWith([
      Match.objectLike({ Action: 'sts:AssumeRole', Resource: Match.anyValue() })
    ]) } });
    expect(JSON.stringify(template.toJSON())).toContain(isDev ? 'ctiadev' : 'ctiaprod');
  });
});

describe('CDK app', () => {
  it.each(stages)('creates only the explicitly selected %s stack', (stage) => {
    const app = createContextiaApp({ ...target, stage, webAssetPath });
    expect(app.node.children.filter((child) => Stack.isStack(child)).map((child) => child.node.id)).toEqual([`contextia-${stage}-core`]);
  });

  it.each([
    { ...target },
    { ...target, stage: 'staging' },
    { ...target, stage: 'dev', account: '000000000000' },
    { ...target, stage: 'dev', region: 'us-east-1' }
  ])('rejects an invalid target before creating infrastructure', (options) => {
    expect(() => createContextiaApp({ ...options, webAssetPath })).toThrow();
  });

  it('requires a built Scenario Console', () => {
    const empty = mkdtempSync(join(tmpdir(), 'contextia-empty-'));
    expect(() => createContextiaApp({ ...target, stage: 'dev', webAssetPath: empty })).toThrow('pnpm build');
  });
});
