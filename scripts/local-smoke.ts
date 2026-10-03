import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Inject protected local test-user credentials in process memory only; smoke.ts handles safe diagnostics.
const credentials = z.record(z.string(), z.string()).parse(JSON.parse(readFileSync('.superpowers/smoke-dev.credentials.json', 'utf8')) as unknown);
// Dedicated users and the deployed output file are the sole sources for this local run.
for (const name of ['SMOKE_ACCESS_TOKEN', 'SMOKE_SECOND_USER_ACCESS_TOKEN', 'SMOKE_API_URL', 'SMOKE_WEB_URL', 'SMOKE_WEB_CLIENT_ID', 'SMOKE_TABLE_NAME']) delete process.env[name];
for (const name of ['SMOKE_USER_1_USERNAME', 'SMOKE_USER_1_PASSWORD', 'SMOKE_USER_2_USERNAME', 'SMOKE_USER_2_PASSWORD']) {
  process.env[name] = z.string().min(1).parse(credentials[name]);
}
process.env.SMOKE_OUTPUTS_FILE = 'cdk.out/dev/outputs.json';
process.env.SMOKE_MODE = 'authenticated';
process.argv[2] = 'dev';
await import('./smoke.js');
