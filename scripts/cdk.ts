import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_AWS_ACCOUNT, EXPECTED_AWS_REGION, parseDeploymentConfig } from '@contextia/config';
import { cdkArgs, deploymentParameters, parseCdkInvocations, requireProductionMain } from './cdk-command.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function awsText(args: string[]): string {
  return execFileSync('aws', [...args, '--cli-connect-timeout', '5', '--cli-read-timeout', '5'], {
    encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

try {
  for (const invocation of parseCdkInvocations(process.argv.slice(2))) {
    const live = invocation.action !== 'synth';
    const deploying = invocation.action === 'deploy';
    if (deploying && invocation.stage === 'prod') {
      const branch = process.env.GITHUB_ACTIONS === 'true' ? '' : execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8', cwd: root }).trim();
      requireProductionMain(process.env, branch);
    }
    const parameters = deploying ? deploymentParameters(process.env) : [];
    const account = live
      ? awsText(['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'])
      : process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? EXPECTED_AWS_ACCOUNT;
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? (live
      ? execFileSync('aws', ['configure', 'get', 'region'], { encoding: 'utf8', timeout: 5_000 }).trim()
      : process.env.CDK_DEFAULT_REGION ?? EXPECTED_AWS_REGION);
    const head = deploying ? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', cwd: root }).trim() : undefined;
    if (deploying && process.env.BUILD_ID && process.env.BUILD_ID !== head) throw new Error('Build marker must match deployed HEAD');
    const config = parseDeploymentConfig({ stage: invocation.stage, account, region, buildId: process.env.BUILD_ID ?? head });
    const result = spawnSync('pnpm', [...cdkArgs(invocation, join(root, 'cdk.out', invocation.stage)), ...parameters], {
      cwd: root,
      stdio: 'inherit',
      env: {
        ...process.env,
        CDK_DEFAULT_ACCOUNT: config.account,
        CDK_DEFAULT_REGION: config.region,
        AWS_REGION: config.region,
        AWS_EC2_METADATA_DISABLED: 'true',
        BUILD_ID: config.buildId
      }
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
} catch (error: unknown) {
  // Configuration errors contain only this script's target fields; never dump AWS responses or credentials.
  console.error(error instanceof Error && error.name === 'ZodError'
    ? 'CDK target rejected: stage, account, Region, or build ID does not match the approved configuration.'
    : 'CDK command failed. Check the selected profile, target configuration, and command output.');
  process.exitCode = 1;
}
