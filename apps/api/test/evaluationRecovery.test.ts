import { afterEach, describe, expect, it, vi } from 'vitest';
import { getScenarioInput } from '@contextia/test-fixtures';
import type { EvaluationResult } from '@contextia/contracts';
import type { IdempotencyRecord } from '@contextia/providers';
import { createEvaluateContext, defaultEvaluationPolicy } from '../src/application/evaluateContext.js';
import { createEvaluationDomain } from '../src/composition/evaluationDomain.js';
import { NOW, ok, repository } from './support/repository.js';

const context = getScenarioInput('step-goal');
const key = 'd3a508bd-c604-4ae4-a473-555228583e0d';
function setup(timeoutMs = 20000) {
  const state = repository();
  const domain = { ...createEvaluationDomain(), detectCandidates: vi.fn(async () => []), refineCandidates: vi.fn(() => []) };
  const model = { decide: vi.fn() };
  const evaluate = createEvaluateContext({ state, idempotency: state, domain, model,
    places: { searchNearby: vi.fn(), getPlace: vi.fn() }, clock: () => NOW, newId: prefix => `${prefix}-1`,
    policy: { ...defaultEvaluationPolicy, evaluationTimeoutMs: timeoutMs } });
  return { state, domain, model, evaluate };
}
afterEach(() => vi.useRealTimers());

describe('evaluation recovery and deadline', () => {
  it('releases a pre-write failure so the same key succeeds and subsequently replays', async () => {
    const { state, evaluate, domain } = setup();
    let pending: IdempotencyRecord | undefined;
    let cached: EvaluationResult | undefined;
    state.claimIdempotency.mockImplementation(async input => {
      if (pending) return ok({ status: 'existing', record: pending });
      pending = input.record;
      return ok({ status: 'claimed' });
    });
    state.releaseIdempotency.mockImplementation(async input => {
      if (pending?.claimId === input.claimId) pending = undefined;
      return ok(null);
    });
    state.completeIdempotency.mockImplementation(async input => {
      if (!pending || pending.claimId !== input.claimId) throw new Error('Wrong claim owner');
      pending = { ...pending, responsePointer: input.result.evaluationId };
      cached = input.result;
      return ok(null);
    });
    state.getIdempotencyResponse.mockImplementation(async () => ok(cached ?? null));
    state.getProfile.mockResolvedValueOnce({ status: 'error', data: null });
    const request = { userId: 'user-1', context, idempotencyKey: key };
    await expect(evaluate(request)).rejects.toMatchObject({ code: 'STATE_UNAVAILABLE' });
    expect(state.releaseIdempotency).toHaveBeenCalledOnce();
    expect(state.writeContextSnapshot).not.toHaveBeenCalled();
    const firstClaimId = state.claimIdempotency.mock.calls[0]?.[0].record.claimId;
    const result = await evaluate(request);
    expect(result.decision).toBe('silent');
    expect(state.claimIdempotency.mock.calls[1]?.[0].record.claimId).not.toBe(firstClaimId);
    expect(await evaluate(request)).toEqual(result);
    expect(domain.detectCandidates).toHaveBeenCalledOnce();
    expect(state.getProfile).toHaveBeenCalledTimes(2);
  });

  it('preserves the claim when a write times out with an uncertain result', async () => {
    const { state, evaluate } = setup();
    state.writeContextSnapshot.mockResolvedValue({ status: 'timeout', data: null, code: 'TIMEOUT' });
    await expect(evaluate({ userId: 'user-1', context, idempotencyKey: key })).rejects.toMatchObject({ code: 'STATE_UNAVAILABLE' });
    expect(state.releaseIdempotency).not.toHaveBeenCalled();
  });

  it('bounds sequential state reads by one budget and releases a claim before any write', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { state, evaluate, model } = setup(50);
    const originalProfile = state.getProfile.getMockImplementation();
    if (!originalProfile) throw new Error('Missing profile');
    state.getProfile.mockImplementation(async input => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return originalProfile(input);
    });
    state.getState.mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return ok(null);
    });
    const assertion = expect(evaluate({ userId: 'user-1', context, idempotencyKey: key })).rejects.toMatchObject({ code: 'EVALUATION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(state.writeContextSnapshot).not.toHaveBeenCalled();
    expect(model.decide).not.toHaveBeenCalled();
    expect(state.releaseIdempotency).toHaveBeenCalledOnce();
  });

  it('includes idempotency completion in the budget and does not release an uncertain cache write', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const { state, evaluate } = setup(50);
    state.completeIdempotency.mockImplementation(() => new Promise(() => {}));
    const assertion = expect(evaluate({ userId: 'user-1', context, idempotencyKey: key })).rejects.toMatchObject({ code: 'EVALUATION_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    expect(state.completeIdempotency).toHaveBeenCalledOnce();
    expect(state.releaseIdempotency).not.toHaveBeenCalled();
  });
});
