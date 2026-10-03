import { EvaluationResultSchema } from '@contextia/contracts';
import type { ContextInput } from '@contextia/contracts';
import type { EvaluateContext } from './evaluateContext.js';
import { ApiFailure } from './apiFailure.js';

/** Internal composition only: no HTTP route accepts this delivery choice. */
export function createServerPushEvaluation(evaluate: EvaluateContext, dispatch: (input: { userId: string; recommendationId: string }) => Promise<'ready' | 'sent' | 'failed'>) {
  return async (input: { userId: string; context: ContextInput; idempotencyKey: string }) => {
    if (input.context.mode !== 'real' || input.context.deliveryMode !== 'proactive') throw new ApiFailure('STATE_UNAVAILABLE');
    const result = await evaluate({ ...input, deliveryPath: 'remote' });
    if (result.decision === 'silent' || !result.recommendationId) return result;
    const status = await dispatch({ userId: input.userId, recommendationId: result.recommendationId });
    if (status === 'ready') throw new ApiFailure('STATE_UNAVAILABLE');
    return EvaluationResultSchema.parse({ ...result, delivery: { ...result.delivery, status } });
  };
}
