import { describe, expect, it } from 'vitest';
import { cdkArgs, deploymentParameters, parseCdkInvocations, requireProductionMain } from './cdk-command.js';

describe('CDK command selection', () => {
  it('synthesizes dev and prod separately', () => {
    expect(parseCdkInvocations(['synth'])).toEqual([{ action: 'synth', stage: 'dev' }, { action: 'synth', stage: 'prod' }]);
  });

  it('selects a single explicit stage for diff', () => {
    expect(parseCdkInvocations(['diff', 'dev'])).toEqual([{ action: 'diff', stage: 'dev' }]);
    expect(cdkArgs({ action: 'diff', stage: 'dev' }, '/tmp/dev')).toEqual([
      '--filter', '@contextia/infra', 'exec', 'cdk', 'diff', 'contextia-dev-core',
      '--context', 'stage=dev', '--output', '/tmp/dev', '--no-lookups', '--exclusively', '--method=template'
    ]);
  });

  it.each([[], ['diff'], ['diff', '--all'], ['synth', 'prod'], ['deploy'], ['deploy', 'staging'], ['diff', 'dev', '--all']])('rejects an unsupported invocation: %s', (...argv) => {
    expect(() => parseCdkInvocations(argv)).toThrow();
  });

  it('requires a manual main workflow for prod and confines deploy to the selected stack', () => {
    expect(() => requireProductionMain({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/feature/test', GITHUB_EVENT_NAME: 'workflow_dispatch' }, '')).toThrow();
    expect(() => requireProductionMain({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push' }, '')).toThrow();
    expect(() => requireProductionMain({}, 'feature/test')).toThrow();
    expect(() => requireProductionMain({ GITHUB_ACTIONS: 'true', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' }, '')).not.toThrow();
    expect(cdkArgs({ action: 'deploy', stage: 'prod' }, '/tmp/prod')).toContain('contextia-prod-core');
    expect(cdkArgs({ action: 'deploy', stage: 'prod' }, '/tmp/prod')).not.toContain('--all');
  });
  it('requires exact model ARNs and an expiring map key before any deployment', () => {
    const parameters = { BEDROCK_MODEL_ID: 'configured-model', BEDROCK_MODEL_RESOURCES: 'arn:aws:bedrock:ap-northeast-1::foundation-model/configured-model', MAP_KEY_EXPIRE_TIME: '2099-01-01T00:00:00Z' };
    expect(deploymentParameters(parameters)).toContain('BedrockModelId=configured-model');
    expect(() => deploymentParameters({ ...parameters, BEDROCK_MODEL_RESOURCES: 'arn:aws:bedrock:*:*:foundation-model/*' })).toThrow();
    expect(() => deploymentParameters({ ...parameters, MAP_KEY_EXPIRE_TIME: '2000-01-01T00:00:00Z' })).toThrow();
    expect(() => deploymentParameters({})).toThrow();
  });

  it('synthesizes only the requested prod stack without a live lookup', () => {
    expect(cdkArgs({ action: 'synth', stage: 'prod' }, '/tmp/prod')).toEqual([
      '--filter', '@contextia/infra', 'exec', 'cdk', 'synth', 'contextia-prod-core',
      '--context', 'stage=prod', '--output', '/tmp/prod', '--no-lookups', '--quiet'
    ]);
  });
});
