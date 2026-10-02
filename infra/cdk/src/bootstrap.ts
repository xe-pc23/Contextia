import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { z } from 'zod';
import { EXPECTED_AWS_ACCOUNT as account, EXPECTED_AWS_REGION as region } from '@contextia/config';

const TemplateSchema = z.object({
  Parameters: z.record(z.string(), z.record(z.string(), z.unknown())),
  Resources: z.record(z.string(), z.object({ Type: z.string(), Properties: z.record(z.string(), z.unknown()) }).passthrough()),
  Outputs: z.record(z.string(), z.record(z.string(), z.unknown()))
}).passthrough();
type Statement = { Effect: 'Allow'; Action: string[]; Resource: string[]; Condition?: Record<string, unknown> };
const allow = (Action: string[], Resource: string[], Condition?: Record<string, unknown>): Statement => ({ Effect: 'Allow', Action, Resource, ...(Condition ? { Condition } : {}) });
const document = (Statement: Statement[]) => ({ Version: '2012-10-17', Statement });
const operations = (service: string, names: string[]) => names.map(name => `${service}:${name}`);

/** File-only adaptation of the pinned official CDK v32 bootstrap, with no admin fallback. */
export function stageBootstrapTemplate(stage: 'dev' | 'prod') {
  const require = createRequire(import.meta.url);
  const source: unknown = parse(readFileSync(require.resolve('aws-cdk/lib/api/bootstrap/bootstrap-template.yaml'), 'utf8'));
  const template = TemplateSchema.parse(source);
  const props = (id: string) => {
    const resource = template.Resources[id];
    if (!resource) throw new Error(`Incompatible CDK bootstrap: ${id}`);
    return resource.Properties;
  };
  if (props('CdkBootstrapVersion').Value !== '32') throw new Error('Review a changed CDK bootstrap version before use');
  const qualifier = stage === 'dev' ? 'ctiadev' : 'ctiaprod';
  const prefix = `contextia-${stage}`;
  const roleSuffix = `${account}-${region}`;
  const localRole = stage === 'dev' ? 'HackathonDevDeployRole' : 'HackathonProdDeployRole';
  const githubRole = stage === 'dev' ? 'GitHubDevDeployRole' : 'GitHubProdDeployRole';
  const arn = (service: string, resource: string, regional = true) => `arn:aws:${service}:${regional ? region : ''}:${account}:${resource}`;
  const cfnResources = [arn('cloudformation', `stack/${prefix}-core/*`), arn('cloudformation', `changeSet/${prefix}-core-*/*`)];
  const bucket = `arn:aws:s3:::cdk-${qualifier}-assets-${roleSuffix}`;
  const trust = (roleNames: string[]) => ({ Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { AWS: `arn:aws:iam::${account}:root` }, Action: ['sts:AssumeRole', 'sts:TagSession'], Condition: { ArnEquals: { 'aws:PrincipalArn': roleNames.map(name => `arn:aws:iam::${account}:role/${name}`) }, Null: { 'sts:ExternalId': 'true' } } }] });
  const qualifierParameter = template.Parameters.Qualifier;
  const variant = template.Parameters.BootstrapVariant;
  if (!qualifierParameter || !variant) throw new Error('Missing bootstrap parameters');
  qualifierParameter.Default = qualifier; qualifierParameter.AllowedValues = [qualifier];
  variant.Default = `Contextia ${stage} file-only v32`;
  template.Description = `Contextia ${stage} CDK file assets and scoped deployment roles`;
  for (const id of ['ContainerAssetsRepository', 'ImagePublishingRole', 'ImagePublishingRoleDefaultPolicy', 'FileAssetsBucketEncryptionKey', 'FileAssetsBucketEncryptionKeyAlias', 'CdkBoostrapPermissionsBoundaryPolicy']) delete template.Resources[id];
  delete template.Outputs.ImageRepositoryName;
  template.Outputs.FileAssetKeyArn = { Value: 'AWS_MANAGED_KEY' };
  props('StagingBucket').BucketEncryption = { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] };
  props('StagingBucket').PublicAccessBlockConfiguration = { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true };
  for (const id of ['FilePublishingRole', 'DeploymentActionRole', 'LookupRole']) {
    props(id).AssumeRolePolicyDocument = trust(id === 'LookupRole' ? [localRole] : [localRole, githubRole]);
    delete props(id).ManagedPolicyArns; delete props(id).PermissionsBoundary;
  }
  props('FilePublishingRoleDefaultPolicy').PolicyDocument = document([
    allow(operations('s3', ['GetObject', 'GetObjectVersion', 'PutObject', 'DeleteObject', 'GetBucketLocation', 'GetEncryptionConfiguration', 'ListBucket', 'ListBucketMultipartUploads', 'ListMultipartUploadParts', 'AbortMultipartUpload']), [bucket, `${bucket}/*`])
  ]);
  const cfnRead = operations('cloudformation', ['DescribeStacks', 'DescribeStackEvents', 'DescribeStackResources', 'DescribeChangeSet', 'GetTemplate', 'GetTemplateSummary', 'ListStackResources']);
  props('LookupRole').Policies = [{ PolicyName: 'stage-read', PolicyDocument: document([allow(cfnRead, cfnResources)]) }];
  props('DeploymentActionRole').Policies = [{ PolicyName: 'stage-deploy', PolicyDocument: document([
    allow([...cfnRead, ...operations('cloudformation', ['CreateChangeSet', 'DeleteChangeSet', 'ExecuteChangeSet', 'CreateStack', 'UpdateStack', 'RollbackStack', 'ContinueUpdateRollback'])], cfnResources),
    allow(['iam:PassRole'], [`arn:aws:iam::${account}:role/cdk-${qualifier}-cfn-exec-role-${roleSuffix}`], { StringEquals: { 'iam:PassedToService': 'cloudformation.amazonaws.com' } }),
    allow(operations('s3', ['GetObject', 'GetObjectVersion', 'GetBucketLocation', 'ListBucket']), [bucket, `${bucket}/*`]),
    allow(['ssm:GetParameter', 'ssm:GetParameters'], [arn('ssm', `parameter/cdk-bootstrap/${qualifier}/version`)]),
    allow(['sts:GetCallerIdentity'], ['*'])
  ]) }];
  const roleResources = [`arn:aws:iam::${account}:role/${prefix}-*`, `arn:aws:iam::${account}:role/${githubRole}`];
  const stageTags = { StringEquals: { 'aws:ResourceTag/project': 'contextia', 'aws:ResourceTag/stage': stage } };
  const policies: Statement[] = [
    allow(['ssm:GetParameter', 'ssm:GetParameters'], [arn('ssm', `parameter/cdk-bootstrap/${qualifier}/version`)]),
    allow(operations('iam', ['CreateRole', 'DeleteRole', 'GetRole', 'UpdateRole', 'UpdateRoleDescription', 'UpdateAssumeRolePolicy', 'PutRolePolicy', 'DeleteRolePolicy', 'GetRolePolicy', 'ListRolePolicies', 'ListAttachedRolePolicies', 'TagRole', 'UntagRole']), roleResources),
    allow(operations('iam', ['AttachRolePolicy', 'DetachRolePolicy']), roleResources, { ArnEquals: { 'iam:PolicyARN': 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole' } }),
    allow(['iam:PassRole'], [roleResources[0] as string], { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } }),
    allow(operations('lambda', ['CreateFunction', 'DeleteFunction', 'GetFunction', 'GetFunctionConfiguration', 'GetFunctionCodeSigningConfig', 'GetFunctionRecursionConfig', 'GetRuntimeManagementConfig', 'GetFunctionScalingConfig', 'UpdateFunctionCode', 'UpdateFunctionConfiguration', 'GetPolicy', 'AddPermission', 'RemovePermission', 'ListVersionsByFunction', 'TagResource', 'UntagResource', 'ListTags']), [arn('lambda', `function:${prefix}-*`)]),
    allow(operations('lambda', ['PublishLayerVersion', 'GetLayerVersion', 'DeleteLayerVersion']), [arn('lambda', `layer:${prefix}-core-*`), arn('lambda', `layer:${prefix}-core-*:*`)]),
    allow(['lambda:InvokeFunction'], [arn('lambda', `function:${prefix}-core-*`)]),
    allow(operations('dynamodb', ['CreateTable', 'DeleteTable', 'DescribeTable', 'UpdateTable', 'DescribeTimeToLive', 'UpdateTimeToLive', 'DescribeContinuousBackups', 'UpdateContinuousBackups', 'TagResource', 'UntagResource', 'ListTagsOfResource']), [arn('dynamodb', `table/${prefix}-data`)]),
    allow(operations('logs', ['CreateLogGroup', 'DeleteLogGroup', 'PutRetentionPolicy', 'DeleteRetentionPolicy', 'TagResource', 'UntagResource', 'ListTagsForResource', 'GetDataProtectionPolicy']), [arn('logs', `log-group:/aws/contextia/${stage}/*`), arn('logs', `log-group:/aws/lambda/${prefix}-*`)]),
    allow(operations('logs', ['DescribeLogGroups', 'DescribeIndexPolicies', 'DescribeResourcePolicies']), ['*'], { StringEquals: { 'aws:RequestedRegion': region } }),
    allow(operations('s3', ['CreateBucket', 'DeleteBucket', 'GetBucketAcl', 'GetBucketPolicy', 'GetBucketPolicyStatus', 'GetBucketLocation', 'GetBucketTagging', 'GetBucketPublicAccessBlock', 'GetBucketOwnershipControls', 'GetBucketVersioning', 'GetBucketCors', 'GetBucketLogging', 'GetBucketWebsite', 'GetBucketNotification', 'GetBucketObjectLockConfiguration', 'GetLifecycleConfiguration', 'GetEncryptionConfiguration', 'ListBucket', 'PutBucketAcl', 'PutBucketPolicy', 'DeleteBucketPolicy', 'PutBucketPublicAccessBlock', 'PutBucketOwnershipControls', 'DeleteBucketOwnershipControls', 'PutBucketTagging', 'PutEncryptionConfiguration']), [`arn:aws:s3:::${prefix}-core-*`]),
    allow(operations('s3', ['GetAccelerateConfiguration', 'GetAnalyticsConfiguration', 'GetInventoryConfiguration', 'GetMetricsConfiguration', 'GetReplicationConfiguration', 'ListTagsForResource', 'GetBucketAbac', 'GetIntelligentTieringConfiguration', 'GetBucketMetadataTableConfiguration']), [`arn:aws:s3:::${prefix}-core-*`]),
    allow(operations('s3', ['GetObject', 'GetObjectVersion', 'GetBucketLocation', 'ListBucket']), [bucket, `${bucket}/*`]),
    // AWS API and authorization references document different key ARN prefixes. Both names stay exact.
    allow(operations('geo', ['CreateKey', 'DescribeKey', 'UpdateKey', 'DeleteKey', 'TagResource', 'UntagResource', 'ListTagsForResource']), [arn('geo', `api-key/${prefix}-web-map`), arn('geo', `key/${prefix}-web-map`)]),
    // Creating/updating a key also authorizes the specific map action granted by its restrictions.
    allow(['geo-maps:GetTile'], [`arn:aws:geo-maps:${region}::provider/default`]),
    allow(['cognito-idp:CreateUserPool'], ['*'], { StringEquals: { 'aws:RequestTag/project': 'contextia', 'aws:RequestTag/stage': stage } }),
    allow(['cognito-idp:TagResource'], [arn('cognito-idp', 'userpool/*')], { StringEquals: { 'aws:RequestTag/project': 'contextia', 'aws:RequestTag/stage': stage } }),
    allow(operations('cognito-idp', ['DeleteUserPool', 'DescribeUserPool', 'UpdateUserPool', 'CreateUserPoolClient', 'DeleteUserPoolClient', 'DescribeUserPoolClient', 'UpdateUserPoolClient', 'CreateUserPoolDomain', 'DeleteUserPoolDomain', 'UpdateUserPoolDomain', 'SetUserPoolMfaConfig', 'GetUserPoolMfaConfig', 'TagResource', 'UntagResource', 'ListTagsForResource']), [arn('cognito-idp', 'userpool/*')], stageTags),
    allow(['cognito-idp:DescribeUserPoolDomain'], ['*'], { StringEquals: { 'aws:RequestedRegion': region } }),
    // API Gateway creates this AWS-managed account service role on its first API integration.
    allow(['iam:CreateServiceLinkedRole'], [`arn:aws:iam::${account}:role/aws-service-role/ops.apigateway.amazonaws.com/AWSServiceRoleForAPIGateway`],
      { StringEquals: { 'iam:AWSServiceName': 'ops.apigateway.amazonaws.com' } }),
    allow(operations('apigateway', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), [`arn:aws:apigateway:${region}::/apis`, `arn:aws:apigateway:${region}::/apis/*`, `arn:aws:apigateway:${region}::/tags/*`]),
    allow(operations('cloudfront', ['CreateDistribution', 'CreateDistributionWithTags', 'CreateOriginAccessControl']), ['*']),
    allow(['cloudfront:TagResource'], [arn('cloudfront', 'distribution/*', false)], { StringEquals: { 'aws:RequestTag/project': 'contextia', 'aws:RequestTag/stage': stage } }),
    allow(operations('cloudfront', ['GetDistribution', 'GetDistributionConfig', 'UpdateDistribution', 'DeleteDistribution', 'TagResource', 'UntagResource', 'ListTagsForResource']), [arn('cloudfront', 'distribution/*', false)], stageTags),
    allow(operations('cloudfront', ['GetOriginAccessControl', 'UpdateOriginAccessControl', 'DeleteOriginAccessControl']), [arn('cloudfront', 'origin-access-control/*', false)])
  ];
  delete props('CloudFormationExecutionRole').ManagedPolicyArns;
  delete props('CloudFormationExecutionRole').PermissionsBoundary;
  props('CloudFormationExecutionRole').Policies = [{ PolicyName: 'contextia-core-execution', PolicyDocument: document(policies) }];
  if (stage === 'dev') template.Resources.GitHubOidcProvider = {
    Type: 'AWS::IAM::OIDCProvider', Properties: { Url: 'https://token.actions.githubusercontent.com', ClientIdList: ['sts.amazonaws.com'], Tags: [{ Key: 'project', Value: 'contextia' }] }, DeletionPolicy: 'RetainExceptOnCreate', UpdateReplacePolicy: 'Retain'
  };
  return template;
}
