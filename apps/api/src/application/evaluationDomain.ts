import type { CandidateOpportunity, ContextInput, DeliveryMode, UserPreferences } from '@contextia/contracts';
import type { DeliveryGuardCode, UserState } from '@contextia/providers';

/**
 * What the evaluation service needs from `@contextia/domain`. Lane A owns the guard and
 * detector implementations; the composition root adapts them to this shape once they land.
 */
export interface GuardCheckInput {
  now: Date;
  deliveryMode: DeliveryMode;
  preferences: UserPreferences;
  state: UserState | null;
  contextFingerprint: string;
  opportunity?: Pick<CandidateOpportunity, 'type' | 'anchorKey'>;
}

export interface GuardCheck {
  /** False only for guarded proactive delivery; preview always continues with diagnostics. */
  shouldEvaluate: boolean;
  guardCodes: DeliveryGuardCode[];
  notificationDay: string;
  maxDailyNotifications: number;
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
