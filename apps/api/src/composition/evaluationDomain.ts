import {
  defaultDeliveryPolicy, detectCandidates, evaluateDeliveryGuards, localDate, normalizeDetectorContext,
  phase2Detectors, refineCandidates, stepGoalRestDetector
} from '@contextia/domain';
import type { DeliveryGuardState, DeliveryPolicy, TriggerDetector } from '@contextia/domain';
import type { EvaluationDomain, GuardUserState } from '../application/evaluationDomain.js';

export const phase1Detectors: readonly TriggerDetector[] = [stepGoalRestDetector];

/**
 * `latestContextProcessedAt` comes from the port once it carries it (issue #5); until then the evaluation
 * service fills it from the matching context snapshot.
 */
export type PersistedUserState = GuardUserState;

/**
 * Maps repository state to the domain guard state. Without the server processing time the
 * fingerprint is withheld: the domain guard would otherwise throw on every repeated context,
 * including preview. The service supplies the time whenever the fingerprint matches.
 */
export function toGuardState(state: PersistedUserState | null): DeliveryGuardState | null {
  if (!state) return null;
  const fingerprint = state.latestContextFingerprint;
  const processedAt = state.latestContextProcessedAt;
  return {
    notificationDay: state.notificationDay,
    notificationsSentToday: state.notificationsSentToday,
    recentAnchors: state.recentAnchors,
    ...(fingerprint && processedAt ? { latestContextFingerprint: fingerprint, latestContextProcessedAt: processedAt } : {})
  };
}

/** Actual elapsed seconds since the first instant of the IANA local date, including DST transitions. */
export function secondsSinceLocalMidnight(now: Date, timezone: string): number {
  const day = localDate(now, timezone);
  let lower = now.getTime() - 48 * 3600 * 1000;
  let upper = now.getTime();
  while (lower + 1 < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (localDate(new Date(middle), timezone) < day) lower = middle;
    else upper = middle;
  }
  return Math.floor((now.getTime() - upper) / 1000);
}

export function createEvaluationDomain(options: { detectors?: readonly TriggerDetector[]; policy?: DeliveryPolicy } = {}): EvaluationDomain {
  const detectors = options.detectors ?? phase2Detectors;
  const policy = options.policy ?? defaultDeliveryPolicy;
  return {
    checkDeliveryGuards(input) {
      const result = evaluateDeliveryGuards({
        clock: { now: () => input.now }, deliveryMode: input.deliveryMode, preferences: input.preferences,
        profileTimezone: input.preferences.timezone, state: toGuardState(input.state),
        contextFingerprint: input.contextFingerprint, policy,
        ...(input.opportunity ? { opportunity: input.opportunity } : {})
      });
      const window = input.opportunity ? policy.anchorDedupByTrigger[input.opportunity.type] : undefined;
      // A local-day anchor becomes "notified since local midnight" for the seconds-based repository recheck.
      const anchorDedupSeconds = window === 'local-day'
        // Repository uses a strict cutoff; include an anchor recorded exactly at local midnight.
        ? secondsSinceLocalMidnight(input.now, result.timezone) + 1
        : window ?? policy.anchorDedupSeconds;
      return {
        shouldEvaluate: result.shouldEvaluate, guardCodes: result.guardCodes,
        notificationDay: result.notificationDay, maxDailyNotifications: result.maxDailyNotifications, anchorDedupSeconds,
        timezone: result.timezone
      };
    },
    async detectCandidates({ context, preferences, now }) {
      const detectorContext = normalizeDetectorContext({ context, preferences, clock: { now: () => now }, profileTimezone: preferences.timezone });
      return detectCandidates(detectorContext, detectors);
    },
    refineCandidates({ context, preferences, now, candidates, evidence }) {
      const detectorContext = normalizeDetectorContext({ context, preferences, clock: { now: () => now }, profileTimezone: preferences.timezone });
      return refineCandidates({ context: detectorContext, candidates, evidence }).candidates;
    }
  };
}
