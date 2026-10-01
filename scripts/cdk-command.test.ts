import { describe, expect, it } from 'vitest';
import { cdkArgs, parseCdkInvocations } from './cdk-command.js';

describe('CDK command selection', () => {
  it('synthesizes dev and prod separately', () => {
    expect(parseCdkInvocations(['synth'])).toEqual([{ action: 'synth', stage: 'dev' }, { action: 'synth', stage: 'prod' }]);
  });

  it('allows only the dev diff', () => {
    expect(parseCdkInvocations(['diff', 'dev'])).toEqual([{ action: 'diff', stage: 'dev' }]);
    expect(cdkArgs({ action: 'diff', stage: 'dev' }, '/tmp/dev')).toEqual([
      '--filter', '@contextia/infra', 'exec', 'cdk', 'diff', 'contextia-dev-core',
      '--context', 'stage=dev', '--output', '/tmp/dev', '--no-lookups', '--exclusively', '--method=template'
    ]);
  });

  it.each([[], ['diff'], ['diff', 'prod'], ['diff', '--all'], ['synth', 'prod'], ['deploy', 'prod'], ['diff', 'dev', '--all']])('rejects an unsupported invocation: %s', (...argv) => {
    expect(() => parseCdkInvocations(argv)).toThrow();
  });

  it('synthesizes only the requested prod stack without a live lookup', () => {
    expect(cdkArgs({ action: 'synth', stage: 'prod' }, '/tmp/prod')).toEqual([
      '--filter', '@contextia/infra', 'exec', 'cdk', 'synth', 'contextia-prod-core',
      '--context', 'stage=prod', '--output', '/tmp/prod', '--no-lookups', '--quiet'
    ]);
  });
});
