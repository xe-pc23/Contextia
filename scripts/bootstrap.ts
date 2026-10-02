import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { CloudFormationClient, CreateChangeSetCommand, DescribeChangeSetCommand, DescribeStackEventsCommand, DescribeStacksCommand, ExecuteChangeSetCommand, ValidateTemplateCommand } from '@aws-sdk/client-cloudformation';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { z } from 'zod';
import { EXPECTED_AWS_ACCOUNT, EXPECTED_AWS_REGION } from '@contextia/config';
import { stageBootstrapTemplate } from '../infra/cdk/src/bootstrap.js';
import { requireProductionMain } from './cdk-command.js';
import { execFileSync } from 'node:child_process';

const action = z.enum(['prepare', 'validate', 'apply']).parse(process.argv[2]);
const stage = z.enum(['dev', 'prod']).parse(process.argv[3]);
const folder = `cdk.out/${stage}`;
const assets = z.object({ dockerImages: z.record(z.string(), z.unknown()).optional() }).parse(JSON.parse(readFileSync(`${folder}/contextia-${stage}-core.assets.json`, 'utf8')) as unknown);
if (Object.keys(assets.dockerImages ?? {}).length) throw new Error('File-only bootstrap cannot publish Docker assets');
const body = JSON.stringify(stageBootstrapTemplate(stage), null, 2);
mkdirSync(folder, { recursive: true });
writeFileSync(`${folder}/bootstrap-template.json`, body);
console.log(JSON.stringify({ stage, template: `${folder}/bootstrap-template.json`, sha256: createHash('sha256').update(body).digest('hex') }));
if (action !== 'prepare') {
  const region = process.env.AWS_REGION ?? EXPECTED_AWS_REGION;
  const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
  if (identity.Account !== EXPECTED_AWS_ACCOUNT || region !== EXPECTED_AWS_REGION) throw new Error('Unexpected AWS account or Region');
  const cfn = new CloudFormationClient({ region });
  await cfn.send(new ValidateTemplateCommand({ TemplateBody: body }));
  console.log('Bootstrap template validated by CloudFormation.');
  if (action === 'apply') {
    if (stage === 'prod') requireProductionMain(process.env, execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim());
    const StackName = `contextia-${stage}-bootstrap`;
    let exists = false;
    try { await cfn.send(new DescribeStacksCommand({ StackName })); exists = true; }
    catch (cause: unknown) { if (!(cause instanceof Error) || cause.name !== 'ValidationError' || !cause.message.includes('does not exist')) throw cause; }
    const ChangeSetName = `${StackName}-${randomUUID()}`;
    await cfn.send(new CreateChangeSetCommand({ StackName, ChangeSetName, ChangeSetType: exists ? 'UPDATE' : 'CREATE', TemplateBody: body, Capabilities: ['CAPABILITY_NAMED_IAM'], Tags: [{ Key: 'project', Value: 'contextia' }, { Key: 'stage', Value: stage }] }));
    const deadline = Date.now() + 30 * 60_000;
    for (;;) {
      const change = await cfn.send(new DescribeChangeSetCommand({ StackName, ChangeSetName }));
      if (change.Status === 'FAILED') {
        if (exists && /didn't contain changes|No updates are to be performed/.test(change.StatusReason ?? '')) {
          console.log('Bootstrap unchanged; no update required.');
          process.exit(0);
        }
        throw new Error(`Bootstrap change set failed: ${change.StatusReason ?? 'unknown reason'}`);
      }
      if (change.Status === 'CREATE_COMPLETE') {
        console.log(JSON.stringify({ stack: StackName, changes: change.Changes?.map(item => ({ action: item.ResourceChange?.Action, id: item.ResourceChange?.LogicalResourceId, type: item.ResourceChange?.ResourceType })) }));
        break;
      }
      if (Date.now() > deadline) throw new Error('Bootstrap change set timed out');
      await setTimeout(5000);
    }
    await cfn.send(new ExecuteChangeSetCommand({ StackName, ChangeSetName }));
    let previous = '';
    for (;;) {
      const stack = (await cfn.send(new DescribeStacksCommand({ StackName }))).Stacks?.[0];
      const status = stack?.StackStatus ?? 'UNKNOWN';
      if (status !== previous) { console.log(JSON.stringify({ stack: StackName, status })); previous = status; }
      if (status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE') break;
      if (!status.endsWith('_IN_PROGRESS')) {
        const events = await cfn.send(new DescribeStackEventsCommand({ StackName }));
        console.error(JSON.stringify(events.StackEvents?.filter(event => event.ResourceStatus?.endsWith('FAILED')).map(event => ({ id: event.LogicalResourceId, status: event.ResourceStatus, reason: event.ResourceStatusReason }))));
        throw new Error('Bootstrap deployment failed');
      }
      if (Date.now() > deadline) throw new Error('Bootstrap deployment timed out; inspect the stack before retrying');
      await setTimeout(5000);
    }
  }
}
