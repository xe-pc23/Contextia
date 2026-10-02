import { createHash } from 'node:crypto';
import { EvaluationResultSchema } from '@contextia/contracts';
import type { ContextInput, EvaluationResult } from '@contextia/contracts';
import type { StateRepository, StoragePlace } from '@contextia/providers';
import { ApiFailure } from './apiFailure.js';

export type IdempotencyRepository = Pick<StateRepository, 'claimIdempotency' | 'completeIdempotency' | 'getIdempotencyResponse'>;
type Claim = { replay: EvaluationResult } | { complete(result: EvaluationResult, storagePlaces: StoragePlace[]): Promise<EvaluationResult> };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function evaluationRequestHash(userId: string, context: ContextInput): string {
  return createHash('sha256').update(JSON.stringify(canonical({ operation: 'POST /v1/context/evaluate', userId, context }))).digest('hex');
}

export async function claimEvaluation(input: {
  state: IdempotencyRepository; userId: string; context: ContextInput; key: string; now: Date; ttlSeconds: number;
}): Promise<Claim> {
  const { state, userId, context, key, now } = input;
  const nowEpochSeconds = Math.floor(now.getTime() / 1000);
  const requestHash = evaluationRequestHash(userId, context);
  const expiresAt = nowEpochSeconds + input.ttlSeconds;
  const result = await state.claimIdempotency({
    userId, nowEpochSeconds, record: { key, requestHash, responsePointer: null, createdAt: now.toISOString(), expiresAt }
  });
  if (result.status !== 'ok' && result.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
  if (result.data.status === 'conflict') throw new ApiFailure('IDEMPOTENCY_CONFLICT');
  if (result.data.status === 'existing') {
    const record = result.data.record;
    if (record.requestHash !== requestHash || record.key !== key) throw new ApiFailure('IDEMPOTENCY_CONFLICT');
    if (record.expiresAt <= nowEpochSeconds || !record.responsePointer) throw new ApiFailure('IDEMPOTENCY_IN_PROGRESS');
    const cached = await state.getIdempotencyResponse({ userId, key, requestHash, nowEpochSeconds });
    if (cached.status !== 'ok' && cached.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
    if (!cached.data) throw new ApiFailure('IDEMPOTENCY_IN_PROGRESS');
    const parsed = EvaluationResultSchema.safeParse(cached.data);
    if (!parsed.success || parsed.data.evaluationId !== record.responsePointer) throw new ApiFailure('STATE_UNAVAILABLE');
    return { replay: parsed.data };
  }
  return {
    async complete(result, storagePlaces) {
      const completed = await state.completeIdempotency({ userId, key, requestHash, result, storagePlaces, expiresAt });
      if (completed.status !== 'ok' && completed.status !== 'degraded') throw new ApiFailure('STATE_UNAVAILABLE');
      return result;
    }
  };
}
