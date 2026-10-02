import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { runAuthenticatedSmoke, runPublicSmoke, SmokeTargetSchema } from './smoke-checks.js';

try {
  const stage = z.enum(['dev', 'prod']).parse(process.argv[2]);
  const outputs = process.env.SMOKE_OUTPUTS_FILE
    ? z.record(z.string(), z.record(z.string(), z.string())).parse(JSON.parse(readFileSync(process.env.SMOKE_OUTPUTS_FILE, 'utf8')) as unknown)[`contextia-${stage}-core`]
    : undefined;
  const target = SmokeTargetSchema.parse({ stage, buildId: process.env.BUILD_ID,
    apiBaseUrl: process.env.SMOKE_API_URL ?? outputs?.ApiBaseUrl, webUrl: process.env.SMOKE_WEB_URL ?? outputs?.WebUrl });
  await runPublicSmoke(target);
  console.log(`Public ${stage} smoke passed at ${target.buildId}.`);
  const accessToken = process.env.SMOKE_ACCESS_TOKEN;
  const secondUserToken = process.env.SMOKE_SECOND_USER_ACCESS_TOKEN;
  if (accessToken || secondUserToken) {
    if (!accessToken || !secondUserToken) throw new Error('Two distinct access tokens are required for authenticated smoke');
    await runAuthenticatedSmoke(target, { accessToken, secondUserToken });
    console.log(`Authenticated ${stage} scenario/ownership/idempotency smoke passed.`);
  } else console.log('Authenticated scenario smoke was not run (no access tokens supplied).');
} catch {
  // Validation/upstream errors may contain private response data. Report only this fixed diagnostic.
  console.error('Smoke failed. Check the selected stage, deployed SHA, public assets and authenticated provider readiness.');
  process.exitCode = 1;
}
