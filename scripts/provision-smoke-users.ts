import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand, CognitoIdentityProviderClient, DescribeUserPoolClientCommand, DescribeUserPoolCommand } from '@aws-sdk/client-cognito-identity-provider';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { z } from 'zod';
import { EXPECTED_AWS_ACCOUNT, EXPECTED_AWS_REGION } from '@contextia/config';

try {
  // Local proof is the default. Exporting generated passwords requires a separate explicit invocation/authorization.
  const destination = z.enum(['local', 'github-dev']).parse(process.argv[2] ?? 'local');
  const region = process.env.AWS_REGION ?? EXPECTED_AWS_REGION;
  const identity = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
  if (identity.Account !== EXPECTED_AWS_ACCOUNT || region !== EXPECTED_AWS_REGION) throw new Error('Wrong target');
  const outputs = z.record(z.string(), z.record(z.string(), z.string())).parse(JSON.parse(readFileSync('cdk.out/dev/outputs.json', 'utf8')) as unknown)['contextia-dev-core'];
  const UserPoolId = z.string().min(1).parse(outputs?.UserPoolId);
  const ClientId = z.string().min(1).parse(outputs?.WebClientId);
  const client = new CognitoIdentityProviderClient({ region });
  const [pool, app] = await Promise.all([client.send(new DescribeUserPoolCommand({ UserPoolId })), client.send(new DescribeUserPoolClientCommand({ UserPoolId, ClientId }))]);
  if (pool.UserPool?.Name !== 'contextia-dev-users' || app.UserPoolClient?.ClientName !== 'contextia-dev-web' || !app.UserPoolClient.ExplicitAuthFlows?.includes('ALLOW_USER_PASSWORD_AUTH')) throw new Error('Not the dev smoke pool/client');
  const credentials: Record<string, string> = {};
  for (const number of [1, 2]) {
    const Username = `contextia-dev-smoke-${number}@contextia.invalid`;
    const password = `Cx7${randomBytes(24).toString('base64url')}`;
    let exists = false;
    try { await client.send(new AdminGetUserCommand({ UserPoolId, Username })); exists = true; }
    catch (cause: unknown) { if (!(cause instanceof Error) || cause.name !== 'UserNotFoundException') throw cause; }
    if (!exists) await client.send(new AdminCreateUserCommand({ UserPoolId, Username, TemporaryPassword: password, MessageAction: 'SUPPRESS', UserAttributes: [{ Name: 'email', Value: Username }, { Name: 'email_verified', Value: 'true' }] }));
    await client.send(new AdminSetUserPasswordCommand({ UserPoolId, Username, Password: password, Permanent: true }));
    credentials[`SMOKE_USER_${number}_USERNAME`] = Username;
    credentials[`SMOKE_USER_${number}_PASSWORD`] = password;
  }
  // Local proof tooling reads this ignored, owner-only file without printing its contents.
  mkdirSync('.superpowers', { recursive: true });
  const path = '.superpowers/smoke-dev.credentials.json';
  writeFileSync(path, JSON.stringify(credentials), { mode: 0o600 }); chmodSync(path, 0o600);
  if (destination === 'github-dev') {
    for (const [name, value] of Object.entries(credentials)) {
      const saved = spawnSync('gh', ['secret', 'set', name, '--repo', 'xe-pc23/Contextia', '--env', 'dev'], { input: value, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      if (saved.status !== 0) throw new Error('Dev secret storage failed');
    }
  }
  console.log(destination === 'github-dev'
    ? 'Two dedicated dev smoke users configured; credentials stored in protected dev secrets and an ignored owner-only local file.'
    : 'Two dedicated dev smoke users configured; credentials stored only in an ignored owner-only local file.');
} catch {
  console.error('Dev smoke-user setup failed. Inspect stage pool/client readiness and local deployment/GitHub permissions without printing credentials.');
  process.exitCode = 1;
}
