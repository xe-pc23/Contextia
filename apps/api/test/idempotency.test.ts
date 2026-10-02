import { describe, expect, it, vi } from 'vitest';
import { EvaluationResultSchema } from '@contextia/contracts';
import { getScenarioInput } from '@contextia/test-fixtures';
import { claimEvaluation, evaluationRequestHash } from '../src/application/idempotency.js';
import { createEvaluateContext } from '../src/application/evaluateContext.js';
import { createRequestHandler } from '../src/handler.js';
import { NOW, ok, repository } from './support/repository.js';

const context = getScenarioInput('step-goal');
const key = 'f1047809-2850-4b7d-98ae-4f534b18b5c1';
const cached = EvaluationResultSchema.parse({ evaluationId: 'eval-cached', recommendationId: null, decision: 'silent', triggerType: null,
  urgency: null, message: null, recommendations: [], decisionReason: 'No candidate.', usedSignals: [],
  delivery: { mode: 'preview', status: 'preview', wouldSuppress: false, guardCodes: [] }, contextExpiresAt: new Date(NOW.getTime() + 86400_000).toISOString(),
  providerStatus: { geocoding: { status: 'not_requested' }, places: { status: 'not_requested' }, weather: { status: 'not_requested' }, routes: { status: 'not_requested' }, bedrock: { status: 'not_requested' } }
});

const existing = (responsePointer: string | null = cached.evaluationId, expiresAt = NOW.getTime() / 1000 + 3600) => ({
  status: 'existing' as const, record: { key, claimId: 'ad0c96a2-5b29-4be3-9208-d4e76265ec0a', requestHash: evaluationRequestHash('user-1', context), responsePointer, expiresAt, createdAt: NOW.toISOString() }
});
describe('evaluation idempotency', () => {
  it('scopes the canonical hash to the user and every input field', () => {
    expect(evaluationRequestHash('user-1', { ...context, calendar: [...context.calendar] })).toBe(evaluationRequestHash('user-1', context));
    expect(evaluationRequestHash('user-2', context)).not.toBe(evaluationRequestHash('user-1', context));
    expect(evaluationRequestHash('user-1', { ...context, scenarioTime: NOW.toISOString() })).not.toBe(evaluationRequestHash('user-1', context));
  });
  it('claims and completes a one-hour cache using only the supplied Storage places', async () => {
    const state = repository();
    const claim = await claimEvaluation({ state, userId: 'user-1', context, key, now: NOW, ttlSeconds: 3600 });
    if ('replay' in claim) throw new Error('Unexpected replay');
    expect(await claim.complete(cached, [])).toEqual(cached);
    expect(state.completeIdempotency).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', key, requestHash: evaluationRequestHash('user-1', context), storagePlaces: [], expiresAt: NOW.getTime() / 1000 + 3600 }));
  });
  it('replays with a fresh HTTP request ID without reading profile or running providers', async () => {
    const state = repository();
    state.claimIdempotency.mockResolvedValue(ok(existing()));
    state.getIdempotencyResponse.mockResolvedValue(ok(cached));
    const evaluate = createEvaluateContext({ state, idempotency: state, clock: () => NOW,
      places: { searchNearby: vi.fn(), getPlace: vi.fn() }, model: { decide: vi.fn() },
      domain: { checkDeliveryGuards: vi.fn(), detectCandidates: vi.fn(), refineCandidates: vi.fn() }, newId: vi.fn() });
    const handle = createRequestHandler({ version: 'test', log: vi.fn(), clients: { webClientId: 'web', mobileClientId: 'mobile' }, evaluate });
    for (const requestId of ['req-first', 'req-retry']) {
      const response = await handle({ method: 'POST', path: '/v1/context/evaluate', requestId, claims: { sub: 'user-1', clientId: 'web' }, body: JSON.stringify(context), idempotencyKey: key });
      expect(JSON.parse(response.body)).toEqual({ requestId, data: cached });
    }
    expect(state.getProfile).not.toHaveBeenCalled();
    expect(state.commitProactiveRecommendation).not.toHaveBeenCalled();
    expect(state.getIdempotencyResponse).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', nowEpochSeconds: NOW.getTime() / 1000 }));
  });
  it.each([[existing(null), 'IDEMPOTENCY_IN_PROGRESS'], [existing(cached.evaluationId, NOW.getTime() / 1000), 'STATE_UNAVAILABLE']] as const)('refuses pending or inconsistently expired records', async (data, code) => {
    const state = repository(); state.claimIdempotency.mockResolvedValue(ok(data));
    await expect(claimEvaluation({ state, userId: 'user-1', context, key, now: NOW, ttlSeconds: 3600 })).rejects.toMatchObject({ code });
  });
  it('refuses a reused key with a different request and a cache pointing at another result', async () => {
    const state = repository(); state.claimIdempotency.mockResolvedValue(ok(existing()));
    await expect(claimEvaluation({ state, userId: 'user-1', context: { ...context, scenarioTime: NOW.toISOString() }, key, now: NOW, ttlSeconds: 3600 })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    state.getIdempotencyResponse.mockResolvedValue(ok({ ...cached, evaluationId: 'another-evaluation' }));
    await expect(claimEvaluation({ state, userId: 'user-1', context, key, now: NOW, ttlSeconds: 3600 })).rejects.toMatchObject({ code: 'STATE_UNAVAILABLE' });
  });
  it('refuses replay when a selector changes even if the context is identical', async () => {
    const state = repository(); state.claimIdempotency.mockResolvedValue(ok(existing()));
    await expect(claimEvaluation({ state, userId: 'user-1', context, key, now: NOW, ttlSeconds: 3600, demoFault: 'weather' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(state.getIdempotencyResponse).not.toHaveBeenCalled();
  });
  it('rejects a non-UUID header before invoking evaluation', async () => {
    const evaluate = vi.fn();
    const handle = createRequestHandler({ version: 'test', log: vi.fn(), clients: { webClientId: 'web', mobileClientId: null }, evaluate });
    expect((await handle({ method: 'POST', path: '/v1/context/evaluate', requestId: 'req', claims: { sub: 'user-1', clientId: 'web' }, body: JSON.stringify(context), idempotencyKey: 'bad' })).statusCode).toBe(400);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
