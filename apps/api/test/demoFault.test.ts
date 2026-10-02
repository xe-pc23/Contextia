import { describe, expect, it, vi } from 'vitest';
import { EvaluationResultSchema } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import { createRequestHandler } from '../src/handler.js';
import type { HandlerOptions } from '../src/handler.js';
import { evaluationRequestHash } from '../src/application/idempotency.js';

const context = getScenarioInput('step-goal');
const silent = EvaluationResultSchema.parse({ evaluationId: 'eval-1', decision: 'silent', recommendationId: null,
  triggerType: null, urgency: null, message: null, recommendations: [], decisionReason: 'No opportunity.', usedSignals: [],
  delivery: { mode: 'preview', status: 'preview', wouldSuppress: true, guardCodes: ['NO_CANDIDATE'] },
  contextExpiresAt: '2026-10-02T00:00:00Z', providerStatus: Object.fromEntries(['geocoding', 'places', 'weather', 'routes', 'bedrock'].map(name => [name, { status: 'not_requested' }])) });

describe('dev provider fault boundary', () => {
  it.each(['weather', 'routes'] as const)('passes %s only for the dev Web preview client', async demoFault => {
    const evaluate = vi.fn(async () => silent);
    const handle = createRequestHandler({ stage: 'dev', version: 'test', log: vi.fn(), clients: { webClientId: 'web', mobileClientId: 'mobile' }, evaluate });
    const response = await handle({ method: 'POST', path: '/v1/context/evaluate', requestId: 'req', claims: { sub: 'user-1', clientId: 'web' }, body: JSON.stringify(context), demoFault });
    expect(response.statusCode).toBe(200);
    expect(evaluate).toHaveBeenCalledWith({ userId: 'user-1', context, demoFault });
  });

  it.each([undefined, 'prod'] as const)('rejects a supplied fault when stage is %s before evaluation', async stage => {
    const evaluate = vi.fn(async () => silent);
    const options: HandlerOptions = { version: 'test', log: vi.fn(), clients: { webClientId: 'web', mobileClientId: 'mobile' }, evaluate, ...(stage ? { stage } : {}) };
    const response = await createRequestHandler(options)({ method: 'POST', path: '/v1/context/evaluate', requestId: 'req', claims: { sub: 'user-1', clientId: 'web' }, body: JSON.stringify(context), demoFault: 'weather' });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({ error: { code: 'DEMO_FAULT_FORBIDDEN' } });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('rejects arbitrary fault selectors and mobile requests', async () => {
    const evaluate = vi.fn(async () => silent);
    const handle = createRequestHandler({ stage: 'dev', version: 'test', log: vi.fn(), clients: { webClientId: 'web', mobileClientId: 'mobile' }, evaluate });
    const request = { method: 'POST', path: '/v1/context/evaluate', requestId: 'req', claims: { sub: 'user-1', clientId: 'web' }, body: JSON.stringify(context) };
    expect((await handle({ ...request, demoFault: 'https://untrusted.test' })).statusCode).toBe(400);
    expect((await handle({ ...request, claims: { sub: 'user-1', clientId: 'mobile' }, demoFault: 'weather', body: JSON.stringify({ ...context, mode: 'real', deliveryMode: 'proactive', location: { ...context.location, source: 'gps' } }) })).statusCode).toBe(403);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('includes the selected fault in idempotency while preserving older no-fault hashes', () => {
    const normal = evaluationRequestHash('user-1', context);
    expect(evaluationRequestHash('user-1', context, 'weather')).not.toBe(normal);
    expect(evaluationRequestHash('user-1', context, 'routes')).not.toBe(evaluationRequestHash('user-1', context, 'weather'));
  });
});
