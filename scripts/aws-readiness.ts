import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { IAMClient, GetOpenIDConnectProviderCommand } from '@aws-sdk/client-iam';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { EXPECTED_AWS_ACCOUNT, EXPECTED_AWS_REGION } from '@contextia/config';

// Read-only local profile fallback when AWS MCP's principal cannot inspect stage resources.
// Print resource/configuration facts only, never credentials or token-bearing responses.
const region = process.env.AWS_REGION ?? EXPECTED_AWS_REGION;
const stage = process.argv[2];
if (stage !== 'dev' && stage !== 'prod') throw new Error('Choose dev or prod');
const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
if (identity.Account !== EXPECTED_AWS_ACCOUNT || region !== EXPECTED_AWS_REGION) throw new Error('Unexpected AWS account or Region');
console.log(JSON.stringify({ account: identity.Account, region, principal: identity.Arn }));
const cfn = new CloudFormationClient({ region });
const bedrock = new BedrockClient({ region });
const checks = [
  ...[`contextia-${stage}-core`, `contextia-${stage}-bootstrap`, 'CDKToolkit'].map(StackName => ({ name: StackName, read: async () => {
    const value = await cfn.send(new DescribeStacksCommand({ StackName }));
    return value.Stacks?.map(stack => ({ name: stack.StackName, status: stack.StackStatus, outputs: stack.Outputs }));
  } })),
  { name: 'github-oidc', read: async () => {
    const value = await new IAMClient({ region }).send(new GetOpenIDConnectProviderCommand({ OpenIDConnectProviderArn: `arn:aws:iam::${identity.Account}:oidc-provider/token.actions.githubusercontent.com` }));
    return { url: value.Url, audiences: value.ClientIDList };
  } },
  { name: 'bedrock-models', read: async () => (await bedrock.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT', byInferenceType: 'ON_DEMAND' }))).modelSummaries?.map(model => ({ id: model.modelId, name: model.modelName, provider: model.providerName, lifecycle: model.modelLifecycle?.status })) },
  { name: 'bedrock-profiles', read: async () => (await bedrock.send(new ListInferenceProfilesCommand({}))).inferenceProfileSummaries?.map(profile => ({ id: profile.inferenceProfileId, arn: profile.inferenceProfileArn, status: profile.status, models: profile.models })) }
];
const results = await Promise.allSettled(checks.map(async check => ({ name: check.name, data: await check.read() })));
results.forEach((result, index) => {
  if (result.status === 'fulfilled') console.log(JSON.stringify(result.value));
  else console.log(JSON.stringify({ name: checks[index]?.name, failure: result.reason instanceof Error ? { code: result.reason.name, message: result.reason.message } : 'Unknown AWS failure' }));
});
