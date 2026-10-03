import { describe, expect, it, vi } from 'vitest';
import * as evaluation from '../src/application/evaluateContext.js';
import { composeRuntime } from '../src/runtime.js';

vi.mock('../src/application/evaluateContext.js', async importOriginal => {
  const actual = await importOriginal<typeof evaluation>();
  return { ...actual, createEvaluateContext: vi.fn(() => vi.fn()) };
});

describe('Phase 2 runtime providers', () => {
  it('connects geocoding and Routes adapters to evaluation', () => {
    composeRuntime({ CONTEXTIA_STAGE: 'dev', AWS_REGION: 'ap-northeast-1', TABLE_NAME: 'contextia-dev-data',
      BEDROCK_MODEL_ID: 'configured-model' }, vi.fn());
    const dependencies = vi.mocked(evaluation.createEvaluateContext).mock.calls[0]?.[0];
    expect(dependencies?.geocoding?.geocode).toBeTypeOf('function');
    expect(dependencies?.routes?.getRoute).toBeTypeOf('function');
  });
});
