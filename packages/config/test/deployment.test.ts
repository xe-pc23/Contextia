import { describe, expect, it } from 'vitest';
import { parseDeploymentConfig } from '../src/index.js';

const target = { account: '634512763705', region: 'ap-northeast-1' };

describe('deployment target validation', () => {
  it.each(['dev', 'prod'])('accepts the explicitly selected %s stage', (stage) => {
    expect(parseDeploymentConfig({ ...target, stage, buildId: 'abc123' })).toEqual({
      stage, account: '634512763705', region: 'ap-northeast-1', buildId: 'abc123'
    });
  });

  it.each([undefined, null, '', 'staging', 'DEV'])('rejects a missing or invalid stage: %s', (stage) => {
    expect(() => parseDeploymentConfig({ ...target, stage })).toThrow();
  });

  it.each(['000000000000', undefined, 634512763705])('rejects an unexpected account: %s', (account) => {
    expect(() => parseDeploymentConfig({ ...target, stage: 'dev', account })).toThrow();
  });

  it.each(['us-east-1', undefined, ''])('rejects an unexpected Region: %s', (region) => {
    expect(() => parseDeploymentConfig({ ...target, stage: 'dev', region })).toThrow();
  });

  it('uses a non-secret build marker for local development', () => {
    expect(parseDeploymentConfig({ ...target, stage: 'dev' }).buildId).toBe('development');
  });

  it.each(['', ' ', 'x'.repeat(129)])('rejects an empty or oversized build ID', (buildId) => {
    expect(() => parseDeploymentConfig({ ...target, stage: 'dev', buildId })).toThrow();
  });

  it('rejects unknown configuration fields', () => {
    expect(() => parseDeploymentConfig({ ...target, stage: 'dev', force: true })).toThrow();
  });
});
