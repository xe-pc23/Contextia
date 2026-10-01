import type { CandidateOpportunity, ContextInput, DeliveryMode, UserPreferences } from '@contextia/contracts';
import type { DeliveryGuardCode, UserState } from '@contextia/providers';

/**
 * Repository state plus the server instant at which `latestContextFingerprint` was processed (issue #5):
 * never the client or scenario `capturedAt`. Set whenever that fingerprint matches the current context.
 */
export type GuardUserState = UserState & { latestContextProcessedAt?: string };

/**
 * What the evaluation service needs from `@contextia/domain`. Lane A owns the guard and
 * detector implementations; `composition/evaluationDomain.ts` adapts them to this shape.
 */
export interface GuardCheckInput {
  now: Date;
  deliveryMode: DeliveryMode;
  preferences: UserPreferences;
  state: GuardUserState | null;
  contextFingerprint: string;
  opportunity?: Pick<CandidateOpportunity, 'type' | 'anchorKey'>;
}

export interface GuardCheck {
  /** False only for guarded proactive delivery; preview always continues with diagnostics. */
  shouldEvaluate: boolean;
  guardCodes: DeliveryGuardCode[];
  notificationDay: string;
  maxDailyNotifications: number;
  /** Trigger/anchor window for the repository's atomic delivery recheck, matching the domain policy. */
  anchorDedupSeconds: number;
}

export interface DetectInput {
  context: ContextInput;
  preferences: UserPreferences;
  now: Date;
}

export interface EvaluationDomain {
  checkDeliveryGuards(input: GuardCheckInput): GuardCheck;
  detectCandidates(input: DetectInput): Promise<CandidateOpportunity[]>;
}
