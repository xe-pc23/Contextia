import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const source = workflow.match(/ {8}run: \|\n([\s\S]*?)\n {2}validate:/)?.[1];
if (!source) throw new Error('Missing deployment authorization step');
const script = source.split('\n').map(line => line.replace(/^ {10}/, '')).join('\n');

describe('deployment workflow authorization', () => {
  it.each([
    ['dev', 'refs/heads/feature/test', 'collaborator', 0],
    ['prod', 'refs/heads/main', 'xe-pc23', 0],
    ['prod', 'refs/heads/feature/test', 'xe-pc23', 1],
    ['prod', 'refs/heads/main', 'collaborator', 1],
    ['staging', 'refs/heads/main', 'xe-pc23', 1]
  ])('stage %s on %s by %s exits %i before any AWS job', (stage, ref, actor, exit) => {
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: { ...process.env, REQUESTED_EVENT: 'workflow_dispatch', REQUESTED_STAGE: stage, REQUESTED_REF: ref, REQUESTED_ACTOR: actor, REPOSITORY_OWNER: 'xe-pc23' }, encoding: 'utf8'
    });
    expect(result.status).toBe(exit);
    if (exit) expect(result.stdout).toContain('::error::');
    expect(workflow).toContain('needs: [authorize, validate]');
  });
  it('rejects a production stage on a push even from the owner on main', () => {
    const result = spawnSync('bash', ['-e', '-c', script], {
      env: { ...process.env, REQUESTED_EVENT: 'push', REQUESTED_STAGE: 'prod', REQUESTED_REF: 'refs/heads/main', REQUESTED_ACTOR: 'xe-pc23', REPOSITORY_OWNER: 'xe-pc23' }, encoding: 'utf8'
    });
    expect(result.status).toBe(1);
  });
});
