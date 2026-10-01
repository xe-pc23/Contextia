import { defaultDeliveryPolicy, evaluateDeliveryGuards, normalizeDetectorContext, stepGoalRestDetector } from '@contextia/domain';
import type { DeliveryGuardState, DeliveryPolicy, TriggerDetector } from '@contextia/domain';
import type { UserState } from '@contextia/providers';
import type { EvaluationDomain } from '../application/evaluationDomain.js';

export const phase1Detectors: readonly TriggerDetector[] = [stepGoalRestDetector];

/** `latestContextProcessedAt` flows through as soon as the repository port carries it (issue #5). */
export type PersistedUserState = UserState & { latestContextProcessedAt?: string };

/**
 * Maps repository state to the domain guard state. Without the server processing time the
 * fingerprint is withheld: the domain guard would otherwise throw on every repeated context,
 * including preview. Proactive duplicates are still rejected by the repository's atomic recheck.
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

/** Wall-clock seconds elapsed in the local day; on DST transition days this can differ by the shift. */
export function secondsSinceLocalMidnight(now: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(value => value.type === type)?.value ?? Number.NaN);
  const seconds = part('hour') * 3600 + part('minute') * 60 + part('second');
  if (!Number.isFinite(seconds)) throw new RangeError('Unable to resolve local time of day');
  return seconds;
}

export function createEvaluationDomain(options: { detectors?: readonly TriggerDetector[]; policy?: DeliveryPolicy } = {}): EvaluationDomain {
  const detectors = options.detectors ?? phase1Detectors;
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
        ? Math.max(1, secondsSinceLocalMidnight(input.now, result.timezone))
        : window ?? policy.anchorDedupSeconds;
      return {
        shouldEvaluate: result.shouldEvaluate, guardCodes: result.guardCodes,
        notificationDay: result.notificationDay, maxDailyNotifications: result.maxDailyNotifications, anchorDedupSeconds
      };
    },
    async detectCandidates({ context, preferences, now }) {
      const detectorContext = normalizeDetectorContext({ context, preferences, clock: { now: () => now }, profileTimezone: preferences.timezone });
      const found = await Promise.all(detectors.map(detector => detector.detect(detectorContext)));
      return found.flat();
    }
  };
}
