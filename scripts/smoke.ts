import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { runAuthenticatedSmoke, runProactiveSmoke, runPublicSmoke, SmokeCheckError, SmokeTargetSchema } from './smoke-checks.js';
import { smokeAuthentication, smokeMobileAuthentication, smokeMode } from './smoke-auth.js';
import { verifyDevMetrics } from './metrics-smoke.js';
import { createDynamoDbStateRepository } from '@contextia/providers';

try {
  const smokeStartedAt = Date.now();
  const stage = z.enum(['dev', 'prod']).parse(process.argv[2]);
  const outputs = process.env.SMOKE_OUTPUTS_FILE
    ? z.record(z.string(), z.record(z.string(), z.string())).parse(JSON.parse(readFileSync(process.env.SMOKE_OUTPUTS_FILE, 'utf8')) as unknown)[`contextia-${stage}-core`]
    : undefined;
  const target = SmokeTargetSchema.parse({ stage, buildId: process.env.BUILD_ID,
    apiBaseUrl: process.env.SMOKE_API_URL ?? outputs?.ApiBaseUrl, webUrl: process.env.SMOKE_WEB_URL ?? outputs?.WebUrl });
  await runPublicSmoke(target);
  console.log(`Public ${stage} smoke passed at ${target.buildId}.`);
  if (smokeMode(stage, process.env) === 'authenticated') {
    if (stage === 'prod' && !process.env.SMOKE_ACCESS_TOKEN) throw new Error('Production authenticated smoke requires transient PKCE access tokens');
    const tokens = await smokeAuthentication(process.env, process.env.SMOKE_WEB_CLIENT_ID ?? outputs?.WebClientId);
    const tableName = process.env.SMOKE_TABLE_NAME ?? outputs?.TableName;
    if (tableName !== `contextia-${stage}-data`) throw new Error('Authenticated smoke needs the selected stage table');
    const state = createDynamoDbStateRepository({ region: 'ap-northeast-1', tableName, timeoutMs: 5000 });
    await runAuthenticatedSmoke(target, tokens, fetch, state);
    console.log(`Authenticated ${stage} scenario/ownership/idempotency smoke passed.`);
    if (stage === 'dev') {
      const mobileAccessToken = await smokeMobileAuthentication(process.env, process.env.SMOKE_USER_POOL_ID ?? outputs?.UserPoolId, process.env.SMOKE_MOBILE_CLIENT_ID ?? outputs?.MobileClientId);
      await runProactiveSmoke(target, { webAccessToken: tokens.accessToken, mobileAccessToken }, state);
      await verifyDevMetrics(smokeStartedAt);
      console.log('Dev safe EMF request/evaluation/provider/model/decision coverage passed.');
    }
  } else console.log('Public diagnostic only; the authenticated dev gate was not run.');
} catch (cause: unknown) {
  // Validation/upstream errors may contain private response data. Report only this fixed diagnostic.
  console.error(cause instanceof SmokeCheckError ? `Smoke failed: ${cause.message}` : 'Smoke failed. Check the selected stage, deployed SHA, public assets and authenticated provider readiness.');
  process.exitCode = 1;
}
