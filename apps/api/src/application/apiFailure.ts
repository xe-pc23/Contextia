export type ApiFailureCode =
  | 'PROFILE_NOT_FOUND' | 'RECOMMENDATION_NOT_FOUND' | 'STATE_UNAVAILABLE'
  | 'MODEL_UNAVAILABLE' | 'INVALID_MODEL_OUTPUT' | 'INVALID_CURSOR'
  | 'CHAT_LIMIT_REACHED' | 'IDEMPOTENCY_CONFLICT' | 'IDEMPOTENCY_IN_PROGRESS';

/** Public error codes only; provider error bodies and private request data never enter HTTP errors. */
export class ApiFailure extends Error {
  constructor(readonly code: ApiFailureCode) {
    super(code);
    this.name = 'ApiFailure';
  }
}
