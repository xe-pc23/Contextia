import { describe, expect, it } from 'vitest';
import { parseApiRuntimeConfig } from '../src/index.js';

const env = { CONTEXTIA_STAGE: 'dev', AWS_REGION: 'ap-northeast-1', TABLE_NAME: 'contextia-dev-data', BEDROCK_MODEL_ID: 'configured-model' };
describe('API runtime configuration', () => {
  it('reads budgets and retention from environment variables', () => {
    expect(parseApiRuntimeConfig({ ...env, BEDROCK_STRUCTURED_OUTPUT: 'false', ROUTE_CONCURRENCY: '2' })).toMatchObject({
      stage: 'dev', tableName: 'contextia-dev-data', structuredOutput: false, routeConcurrency: 2,
      placesTimeoutMs: 2500, modelTimeoutMs: 7000, evaluationTimeoutMs: 20000, conversationTtlSeconds: 7200, idempotencyTtlSeconds: 3600
    });
  });
  it.each([
    { BEDROCK_MODEL_ID: '' }, { TABLE_NAME: 'contextia-prod-data' }, { AWS_REGION: 'us-east-1' },
    { WEATHER_ENDPOINT: 'http://insecure.example/forecast' }, { ROUTE_CONCURRENCY: '0' }, { ROUTE_CONCURRENCY: '9' },
    { MODEL_TIMEOUT_MS: 'not-a-number' }, { IDEMPOTENCY_TTL_SECONDS: '3601' }, { CONTEXT_TTL_SECONDS: '86401' },
    { EVALUATION_TIMEOUT_MS: '20001' }, { EVALUATION_TIMEOUT_MS: '0' }
  ])('rejects invalid runtime values: %s', override => {
    expect(() => parseApiRuntimeConfig({ ...env, ...override })).toThrow();
  });
});
