import { execFileSync, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_AWS_ACCOUNT, EXPECTED_AWS_REGION, parseDeploymentConfig } from '@contextia/config';
import { cdkArgs, parseCdkInvocations } from './cdk-command.js';

const root = fileURLToPath(new URL('../', import.meta.url));

function awsText(args: string[]): string {
  return execFileSync('aws', [...args, '--cli-connect-timeout', '5', '--cli-read-timeout', '5'], {
    encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

try {
  for (const invocation of parseCdkInvocations(process.argv.slice(2))) {
    const isDiff = invocation.action === 'diff';
    const account = isDiff
      ? awsText(['sts', 'get-caller-identity', '--query', 'Account', '--output', 'text'])
      : process.env.CDK_DEFAULT_ACCOUNT ?? process.env.AWS_ACCOUNT_ID ?? EXPECTED_AWS_ACCOUNT;
    const region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? (isDiff
      ? execFileSync('aws', ['configure', 'get', 'region'], { encoding: 'utf8', timeout: 5_000 }).trim()
      : process.env.CDK_DEFAULT_REGION ?? EXPECTED_AWS_REGION);
    const config = parseDeploymentConfig({ stage: invocation.stage, account, region, buildId: process.env.BUILD_ID });
    const result = spawnSync('pnpm', cdkArgs(invocation, join(root, 'cdk.out', invocation.stage)), {
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
