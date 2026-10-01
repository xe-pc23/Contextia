import { CalendarDateSchema, TimestampSchema } from '@contextia/contracts';
import type { CandidateOpportunity, DeliveryDiagnostics, DeliveryGuardCode, DeliveryMode, UserPreferences } from '@contextia/contracts';
import { clockInstant } from '../context/clock.js';
import type { Clock } from '../context/clock.js';
import { localDate, resolveTimezone } from '../context/timezone.js';

export interface DeliveryPolicy {
  readonly dailyCaps: Readonly<Record<UserPreferences['notificationFrequency'], number>>;
  readonly contextDedupSeconds: number;
  readonly anchorDedupSeconds: number;
  readonly anchorDedupByTrigger: Readonly<Partial<Record<CandidateOpportunity['type'], number | 'local-day'>>>;
}

export const defaultDeliveryPolicy: DeliveryPolicy = Object.freeze({
  dailyCaps: Object.freeze({ low: 1, normal: 3, high: 6 }),
  contextDedupSeconds: 300,
  anchorDedupSeconds: 1800,
  anchorDedupByTrigger: Object.freeze({ STEP_GOAL_REST: 'local-day' })
});

export interface NotifiedAnchor {
  readonly triggerType: CandidateOpportunity['type'];
  readonly anchorKey: string;
  readonly notifiedAt: string;
}

export interface DeliveryGuardState {
  readonly notificationDay: string;
  readonly notificationsSentToday: number;
  readonly latestContextFingerprint?: string;
  // Server processing time, including preview runs; never the simulated capturedAt.
  readonly latestContextProcessedAt?: string;
  readonly recentAnchors: readonly NotifiedAnchor[];
}

export interface DeliveryGuardInput {
  readonly clock: Clock;
  readonly deliveryMode: DeliveryMode;
  readonly preferences: Pick<UserPreferences, 'notificationsEnabled' | 'notificationFrequency'>;
  readonly profileTimezone?: unknown;
  readonly clientTimezone?: unknown;
  readonly state?: DeliveryGuardState | null;
  readonly contextFingerprint: string;
  // Run once before detection without an opportunity, then again per viable candidate.
  readonly opportunity?: Pick<CandidateOpportunity, 'type' | 'anchorKey'>;
  readonly policy?: DeliveryPolicy;
}

export interface DeliveryGuardResult {
  readonly shouldEvaluate: boolean;
  readonly timezone: string;
  readonly notificationDay: string;
  readonly maxDailyNotifications: number;
  readonly guardCodes: DeliveryGuardCode[];
  readonly wouldSuppress: boolean;
  readonly delivery: DeliveryDiagnostics;
}

function isRecent(at: string, now: number, windowSeconds: number): boolean {
  // Invalid persisted state fails closed. A clock moving backwards does not unlock delivery.
  const timestamp = Date.parse(TimestampSchema.parse(at));
  return now - timestamp < windowSeconds * 1000;
}

function validatePolicy(policy: DeliveryPolicy): void {
  const triggerWindows = Object.values(policy.anchorDedupByTrigger);
  const values = [...Object.values(policy.dailyCaps), policy.contextDedupSeconds, policy.anchorDedupSeconds,
    ...triggerWindows.filter(value => value !== 'local-day')];
  if (values.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw new RangeError('Delivery policy values must be positive safe integers');
  }
}

function isDuplicateAnchor(anchor: NotifiedAnchor, now: Date, timezone: string, notificationDay: string, policy: DeliveryPolicy): boolean {
  const window = policy.anchorDedupByTrigger[anchor.triggerType] ?? policy.anchorDedupSeconds;
  if (window !== 'local-day') return isRecent(anchor.notifiedAt, now.getTime(), window);
  const notifiedAt = new Date(TimestampSchema.parse(anchor.notifiedAt));
  // Keep a local-day milestone closed through DST and a backwards-moving clock.
  return notifiedAt.getTime() > now.getTime() || localDate(notifiedAt, timezone) === notificationDay;
}

export function evaluateDeliveryGuards(input: DeliveryGuardInput): DeliveryGuardResult {
  const now = clockInstant(input.clock);
  const policy = input.policy ?? defaultDeliveryPolicy;
  validatePolicy(policy);
  if (!input.contextFingerprint) throw new RangeError('Context fingerprint must not be empty');
  const timezone = resolveTimezone(input.profileTimezone, input.clientTimezone);
  const notificationDay = localDate(now, timezone);
  const maxDailyNotifications = policy.dailyCaps[input.preferences.notificationFrequency];
  const state = input.state;
  // Corrupt persisted dates must not be treated as a legitimate day rollover.
  if (state && !CalendarDateSchema.safeParse(state.notificationDay).success) {
    throw new RangeError('Notification day must be a valid YYYY-MM-DD calendar date');
  }
  if (state && (!Number.isSafeInteger(state.notificationsSentToday) || state.notificationsSentToday < 0)) {
    throw new RangeError('Notification count must be a non-negative safe integer');
  }
  const guardCodes: DeliveryGuardCode[] = [];
  if (!input.preferences.notificationsEnabled) guardCodes.push('NOTIFICATIONS_DISABLED');
  if (state?.notificationDay === notificationDay && state.notificationsSentToday >= maxDailyNotifications) {
    guardCodes.push('DAILY_CAP_REACHED');
  }
  if (state?.latestContextFingerprint === input.contextFingerprint) {
    if (!state.latestContextProcessedAt) throw new RangeError('Matching fingerprint requires server processing time');
    if (isRecent(state.latestContextProcessedAt, now.getTime(), policy.contextDedupSeconds)) guardCodes.push('DUPLICATE_CONTEXT');
  }
  const opportunity = input.opportunity;
  if (opportunity && state?.recentAnchors.some(anchor =>
    anchor.triggerType === opportunity.type && anchor.anchorKey === opportunity.anchorKey &&
    isDuplicateAnchor(anchor, now, timezone, notificationDay, policy)
  )) guardCodes.push('RECENT_SAME_TRIGGER');
  const wouldSuppress = guardCodes.length > 0;
  const delivery: DeliveryDiagnostics = input.deliveryMode === 'preview'
    ? { mode: 'preview', status: 'preview', wouldSuppress, guardCodes: [...guardCodes] }
    : { mode: 'proactive', status: wouldSuppress ? 'suppressed' : 'ready', wouldSuppress, guardCodes: [...guardCodes] };
  return {
    shouldEvaluate: input.deliveryMode === 'preview' || !wouldSuppress,
    timezone, notificationDay, maxDailyNotifications, guardCodes, wouldSuppress, delivery
  };
}
