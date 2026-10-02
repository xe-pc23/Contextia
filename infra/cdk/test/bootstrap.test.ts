import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { stageBootstrapTemplate } from '../src/bootstrap.js';

describe.each(['dev', 'prod'] as const)('%s stage bootstrap', stage => {
  it('has private file assets, pinned provenance and no admin/read-all/docker roles', () => {
    const template = stageBootstrapTemplate(stage);
    const text = JSON.stringify(template.Resources);
    expect(text).not.toMatch(/AdministratorAccess|ReadOnlyAccess|AWSCloudFormationReadOnlyAccess|ImagePublishingRole|ContainerAssetsRepository|kms:Decrypt/);
    expect(template.Resources.StagingBucket?.Properties.PublicAccessBlockConfiguration).toEqual({ BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
    expect(template.Outputs.BootstrapVersion?.Value).toBe('32');
  });
  it('limits role assumption and deployment to the selected stage', () => {
    const template = stageBootstrapTemplate(stage);
    const text = JSON.stringify(template.Resources.DeploymentActionRole);
    expect(text).toContain(stage === 'dev' ? 'HackathonDevDeployRole' : 'HackathonProdDeployRole');
    expect(text).toContain(stage === 'dev' ? 'GitHubDevDeployRole' : 'GitHubProdDeployRole');
    expect(text).toContain(`stack/contextia-${stage}-core/*`);
    expect(text).not.toContain(stage === 'dev' ? 'contextia-prod' : 'contextia-dev');
    expect(text).not.toMatch(/cloudformation:DeleteStack|PipelineCrossAccount|Refactor/);
  });
  it('does not give wildcard service actions to CloudFormation', () => {
    const template = stageBootstrapTemplate(stage);
    const policies = z.array(z.object({ PolicyDocument: z.object({ Statement: z.array(z.object({ Action: z.array(z.string()) })) }) })).parse(template.Resources.CloudFormationExecutionRole?.Properties.Policies);
    const actions = policies.flatMap(policy => policy.PolicyDocument.Statement.flatMap(statement => statement.Action));
    expect(actions.some(action => action.includes('*'))).toBe(false);
  });
  it('lets CloudFormation resolve only the selected bootstrap SSM version parameter', () => {
    const role = JSON.stringify(stageBootstrapTemplate(stage).Resources.CloudFormationExecutionRole);
    expect(role).toContain('ssm:GetParameters');
    expect(role).toContain(`/cdk-bootstrap/${stage === 'dev' ? 'ctiadev' : 'ctiaprod'}/version`);
  });
});
