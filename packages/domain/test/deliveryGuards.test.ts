import { describe, expect, it } from 'vitest';
import { DeliveryDiagnosticsSchema } from '@contextia/contracts';
import { defaultDeliveryPolicy, evaluateDeliveryGuards, localDate, resolveTimezone } from '../src/index.js';
import type { Clock, DeliveryGuardInput, DeliveryGuardState } from '../src/index.js';

const now = '2026-10-01T05:10:00.000Z';
const fixedClock = (at = now): Clock => ({ now: () => new Date(at) });
const state: DeliveryGuardState = { notificationDay: '2026-10-01', notificationsSentToday: 0, recentAnchors: [] };
function input(patch: Partial<DeliveryGuardInput> = {}): DeliveryGuardInput {
  return {
    clock: fixedClock(), deliveryMode: 'proactive',
    preferences: { notificationsEnabled: true, notificationFrequency: 'normal' },
    profileTimezone: 'Asia/Tokyo', contextFingerprint: 'sha256:test', state,
    opportunity: { type: 'STEP_GOAL_REST', anchorKey: '2026-10-01' }, ...patch
  };
}

describe('delivery guards', () => {
  it('allows enabled delivery with no state and reads the injected clock once', () => {
    let reads = 0;
    const result = evaluateDeliveryGuards(input({ state: null, clock: { now: () => { reads++; return new Date(now); } } }));
    expect(reads).toBe(1);
    expect(result).toMatchObject({ shouldEvaluate: true, wouldSuppress: false, guardCodes: [], maxDailyNotifications: 3 });
    expect(result.delivery.status).toBe('ready');
    expect(DeliveryDiagnosticsSchema.parse(result.delivery)).toEqual(result.delivery);
  });

  it.each(['proactive', 'preview'] as const)('diagnoses disabled notifications in %s', deliveryMode => {
    const result = evaluateDeliveryGuards(input({ deliveryMode, preferences: { notificationsEnabled: false, notificationFrequency: 'normal' } }));
    expect(result.guardCodes).toEqual(['NOTIFICATIONS_DISABLED']);
    expect(result.shouldEvaluate).toBe(deliveryMode === 'preview');
    expect(result.delivery.status).toBe(deliveryMode === 'preview' ? 'preview' : 'suppressed');
  });

  for (const [notificationFrequency, cap] of Object.entries(defaultDeliveryPolicy.dailyCaps)) {
    it.each([cap - 1, cap, cap + 1])(`${notificationFrequency} cap ${cap} at count %i`, count => {
      const frequency = notificationFrequency as keyof typeof defaultDeliveryPolicy.dailyCaps;
      const result = evaluateDeliveryGuards(input({
        preferences: { notificationsEnabled: true, notificationFrequency: frequency },
        state: { ...state, notificationsSentToday: count }
      }));
      expect(result.guardCodes).toEqual(count >= cap ? ['DAILY_CAP_REACHED'] : []);
    });
  }

  it('uses configured caps and windows', () => {
    const result = evaluateDeliveryGuards(input({
      policy: { dailyCaps: { low: 2, normal: 4, high: 8 }, contextDedupSeconds: 60, anchorDedupSeconds: 1800,
        anchorDedupByTrigger: { STEP_GOAL_REST: 120 } },
      state: { ...state, notificationsSentToday: 3, latestContextFingerprint: 'sha256:test', latestContextProcessedAt: '2026-10-01T05:08:59Z',
        recentAnchors: [{ triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: '2026-10-01T05:07:59Z' }] }
    }));
    expect(result.guardCodes).toEqual([]);
    expect(result.maxDailyNotifications).toBe(4);
  });

  it.each([299_999, 300_000, 300_001])('fingerprint window at age %i ms', age => {
    const result = evaluateDeliveryGuards(input({ state: {
      ...state, latestContextFingerprint: 'sha256:test', latestContextProcessedAt: new Date(Date.parse(now) - age).toISOString()
    } }));
    expect(result.guardCodes).toEqual(age < 300_000 ? ['DUPLICATE_CONTEXT'] : []);
  });

  it.each([1_799_999, 1_800_000, 1_800_001])('default window for other triggers at age %i ms', age => {
    const result = evaluateDeliveryGuards(input({ opportunity: { type: 'FREE_TIME_NEARBY', anchorKey: 'gap-1' },
      state: { ...state, recentAnchors: [{
      triggerType: 'FREE_TIME_NEARBY', anchorKey: 'gap-1', notifiedAt: new Date(Date.parse(now) - age).toISOString()
    }] } }));
    expect(result.guardCodes).toEqual(age < 1_800_000 ? ['RECENT_SAME_TRIGGER'] : []);
  });

  it.each(['2026-10-01T05:40:00Z', '2026-10-01T05:40:01Z', '2026-10-01T14:59:59.999Z'])('suppresses the same step-goal anchor throughout the local day at %s', at => {
    const result = evaluateDeliveryGuards(input({ clock: fixedClock(at), state: { ...state, recentAnchors: [{
      triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: now
    }] } }));
    expect(result.guardCodes).toEqual(['RECENT_SAME_TRIGGER']);
    expect(result.shouldEvaluate).toBe(false);
  });

  it('expires local-day suppression at midnight even if preview keeps the old scenario anchor', () => {
    const notified = { ...state, recentAnchors: [{
      triggerType: 'STEP_GOAL_REST' as const, anchorKey: '2026-10-01', notifiedAt: now
    }] };
    for (const deliveryMode of ['proactive', 'preview'] as const) {
      expect(evaluateDeliveryGuards(input({ deliveryMode, state: notified,
        clock: fixedClock('2026-10-01T15:00:00Z') })).guardCodes).toEqual([]);
    }
  });

  it('validates matching local-day anchor timestamps and keeps future days closed after clock rollback', () => {
    for (const deliveryMode of ['proactive', 'preview'] as const) {
      expect(() => evaluateDeliveryGuards(input({ deliveryMode, state: { ...state, recentAnchors: [{
        triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: 'invalid'
      }] } }))).toThrow();
    }
    expect(evaluateDeliveryGuards(input({ state: { ...state, recentAnchors: [{
      triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: '2026-10-02T05:10:00Z'
    }] } })).guardCodes).toEqual(['RECENT_SAME_TRIGGER']);
  });

  it('requires an exact fingerprint and both trigger and anchor; checks every anchor', () => {
    const recent = { notifiedAt: now };
    expect(evaluateDeliveryGuards(input({ state: {
      ...state, latestContextFingerprint: 'sha256:other', latestContextProcessedAt: now,
      recentAnchors: [
        { ...recent, triggerType: 'FREE_TIME_NEARBY', anchorKey: '2026-10-01' },
        { ...recent, triggerType: 'STEP_GOAL_REST', anchorKey: '2026-09-30' }
      ]
    } })).guardCodes).toEqual([]);
    expect(evaluateDeliveryGuards(input({ state: { ...state, recentAnchors: [
      { ...recent, triggerType: 'STEP_GOAL_REST', anchorKey: 'other' },
      { ...recent, triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01' }
    ] } })).guardCodes).toEqual(['RECENT_SAME_TRIGGER']);
  });

  it('can run pre-detection guards without an opportunity', () => {
    const preDetection = { ...input({ state: {
      ...state, recentAnchors: [{ triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: now }]
    } }) };
    delete preDetection.opportunity;
    expect(evaluateDeliveryGuards(preDetection).guardCodes).toEqual([]);
  });

  it('collects all four guard codes in stable order and never mutates state, including preview', () => {
    const blockedState: DeliveryGuardState = {
      ...state, notificationsSentToday: 3, latestContextFingerprint: 'sha256:test', latestContextProcessedAt: now,
      recentAnchors: [{ triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: now }]
    };
    const original = structuredClone(blockedState);
    for (const deliveryMode of ['proactive', 'preview'] as const) {
      const result = evaluateDeliveryGuards(input({ deliveryMode, state: blockedState,
        preferences: { notificationsEnabled: false, notificationFrequency: 'normal' } }));
      expect(result.guardCodes).toEqual(['NOTIFICATIONS_DISABLED', 'DAILY_CAP_REACHED', 'DUPLICATE_CONTEXT', 'RECENT_SAME_TRIGGER']);
      expect(result.shouldEvaluate).toBe(deliveryMode === 'preview');
      expect(result.wouldSuppress).toBe(true);
      expect(DeliveryDiagnosticsSchema.safeParse(result.delivery).success).toBe(true);
      expect(blockedState).toEqual(original);
    }
  });

  it('keeps content evaluation available on repeated preview without consuming count or notified anchors', () => {
    const first = evaluateDeliveryGuards(input({ deliveryMode: 'preview' }));
    // Application persistence records processing time, not a notification or the fixed scenario time.
    const processedState = { ...state, latestContextFingerprint: 'sha256:test', latestContextProcessedAt: now };
    const second = evaluateDeliveryGuards(input({ deliveryMode: 'preview', state: processedState, clock: fixedClock('2026-10-01T05:10:01Z') }));
    expect(first.guardCodes).toEqual([]);
    expect(second.guardCodes).toEqual(['DUPLICATE_CONTEXT']);
    expect(first.shouldEvaluate && second.shouldEvaluate).toBe(true);
    expect(processedState.notificationsSentToday).toBe(0);
    expect(processedState.recentAnchors).toEqual([]);
    expect(evaluateDeliveryGuards(input({ state: processedState })).shouldEvaluate).toBe(false);
    expect(evaluateDeliveryGuards(input({ state: processedState, clock: fixedClock('2026-10-01T05:15:00Z') })).shouldEvaluate).toBe(true);
  });

  it('keeps duplicate guards closed for a future timestamp after clock rollback', () => {
    expect(evaluateDeliveryGuards(input({ state: {
      ...state, latestContextFingerprint: 'sha256:test', latestContextProcessedAt: '2026-10-01T05:11:00Z',
      recentAnchors: [{ triggerType: 'STEP_GOAL_REST', anchorKey: '2026-10-01', notifiedAt: '2026-10-01T05:11:00Z' }]
    } })).guardCodes).toEqual(['DUPLICATE_CONTEXT', 'RECENT_SAME_TRIGGER']);
  });

  it('fails safely on invalid clock, count, matching fingerprint timestamp or policy', () => {
    expect(() => evaluateDeliveryGuards(input({ clock: fixedClock('invalid') }))).toThrow();
    expect(() => evaluateDeliveryGuards(input({ state: { ...state, notificationsSentToday: -1 } }))).toThrow();
    expect(() => evaluateDeliveryGuards(input({ state: { ...state, latestContextFingerprint: 'sha256:test' } }))).toThrow();
    expect(() => evaluateDeliveryGuards(input({ state: { ...state, latestContextFingerprint: 'sha256:test', latestContextProcessedAt: 'invalid' } }))).toThrow();
    expect(() => evaluateDeliveryGuards(input({ contextFingerprint: '' }))).toThrow();
    expect(() => evaluateDeliveryGuards(input({ policy: { ...defaultDeliveryPolicy, contextDedupSeconds: 0 } }))).toThrow();
    expect(() => evaluateDeliveryGuards(input({ policy: { ...defaultDeliveryPolicy,
      anchorDedupByTrigger: { STEP_GOAL_REST: 0 } } }))).toThrow();
  });

  for (const deliveryMode of ['proactive', 'preview'] as const) {
    it.each([
      '', 'invalid', '2026-2-01', '2026-02-29', '2026-04-31', '1900-02-29',
      '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-01T00:00:00Z',
      undefined, null, 123, true
    ])(`fails closed on invalid persisted notificationDay %s in ${deliveryMode}`, notificationDay => {
      // Simulate corrupt DB data crossing the typed repository boundary.
      const corruptState = { ...state, notificationsSentToday: 3, notificationDay: notificationDay as string };
      expect(() => evaluateDeliveryGuards(input({ deliveryMode, state: corruptState })))
        .toThrow('Notification day must be a valid YYYY-MM-DD calendar date');
    });
  }

  it.each(['2024-02-29', '2000-02-29'])('accepts the valid leap day %s and preserves cap/rollover behavior', notificationDay => {
    const cappedState = { ...state, notificationDay, notificationsSentToday: 3 };
    const onLeapDay = fixedClock(`${notificationDay}T05:10:00Z`);
    expect(evaluateDeliveryGuards(input({ state: cappedState, clock: onLeapDay })).guardCodes).toEqual(['DAILY_CAP_REACHED']);
    const nextDay = fixedClock(`${notificationDay.slice(0, 4)}-03-01T05:10:00Z`);
    expect(evaluateDeliveryGuards(input({ state: cappedState, clock: nextDay })).guardCodes).toEqual([]);
  });
});

describe('user-local date and timezone', () => {
  it.each([
    { profileTimezone: 'America/Los_Angeles', clientTimezone: 'Asia/Tokyo' },
    { profileTimezone: 'invalid', clientTimezone: 'America/Los_Angeles' }
  ])('keeps step-goal suppression across UTC midnight with resolved timezone $profileTimezone/$clientTimezone', timezones => {
    const notified = { ...state, recentAnchors: [{
      triggerType: 'STEP_GOAL_REST' as const, anchorKey: '2026-10-01', notifiedAt: '2026-10-01T23:00:00Z'
    }] };
    expect(evaluateDeliveryGuards(input({ ...timezones, state: notified,
      clock: fixedClock('2026-10-02T00:00:00Z') })).guardCodes).toEqual(['RECENT_SAME_TRIGGER']);
    expect(evaluateDeliveryGuards(input({ ...timezones, state: notified,
      clock: fixedClock('2026-10-02T07:00:00Z'), opportunity: { type: 'STEP_GOAL_REST', anchorKey: '2026-10-02' }
    })).guardCodes).toEqual([]);
  });

  it.each([
    ['2026-03-08', '2026-03-08T05:00:00Z', '2026-03-08T06:30:00Z', '2026-03-08T07:30:00Z', '2026-03-09T03:59:59.999Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01', '2026-11-01T04:00:00Z', '2026-11-01T05:30:00Z', '2026-11-01T06:30:00Z', '2026-11-02T04:59:59.999Z', '2026-11-02T05:00:00Z']
  ])('suppresses a step-goal for the entire 23/25-hour DST day %s', (day, notifiedAt, beforeTransition, afterTransition, beforeMidnight, midnight) => {
    const notified = { ...state, notificationDay: day, recentAnchors: [{
      triggerType: 'STEP_GOAL_REST' as const, anchorKey: day, notifiedAt
    }] };
    for (const at of [beforeTransition, afterTransition, beforeMidnight]) {
      expect(evaluateDeliveryGuards(input({ profileTimezone: 'America/New_York', state: notified,
        opportunity: { type: 'STEP_GOAL_REST', anchorKey: day }, clock: fixedClock(at)
      })).guardCodes).toEqual(['RECENT_SAME_TRIGGER']);
    }
    // The old anchor also expires: this is a calendar-day policy, not 24 elapsed hours.
    expect(evaluateDeliveryGuards(input({ profileTimezone: 'America/New_York', state: notified,
      opportunity: { type: 'STEP_GOAL_REST', anchorKey: day }, clock: fixedClock(midnight)
    })).guardCodes).toEqual([]);
  });

  it.each([
    ['Asia/Tokyo', 'America/New_York', 'Asia/Tokyo'],
    ['invalid', 'America/New_York', 'America/New_York'],
    [undefined, 'Asia/Tokyo', 'Asia/Tokyo'],
    ['+09:00', 'Asia/Tokyo', 'Asia/Tokyo'],
    [null, 'invalid', 'UTC'], [undefined, undefined, 'UTC']
  ])('resolves profile %s and client %s to %s', (profile, client, expected) => {
    expect(resolveTimezone(profile, client)).toBe(expected);
  });

  it('rolls over at Tokyo midnight while retaining a cap across UTC midnight', () => {
    const capped = { ...state, notificationsSentToday: 3 };
    const before = evaluateDeliveryGuards(input({ state: capped, clock: fixedClock('2026-10-01T14:59:59.999Z') }));
    const after = evaluateDeliveryGuards(input({ state: capped, clock: fixedClock('2026-10-01T15:00:00Z') }));
    expect(before.guardCodes).toEqual(['DAILY_CAP_REACHED']);
    expect(after).toMatchObject({ notificationDay: '2026-10-02', guardCodes: [] });
    expect(evaluateDeliveryGuards(input({ state: capped, clock: fixedClock('2026-10-01T00:00:00Z') })).guardCodes).toEqual(['DAILY_CAP_REACHED']);
    expect(capped.notificationsSentToday).toBe(3);
  });

  it.each([
    ['2026-03-08', '2026-03-08T06:59:59Z', '2026-03-08T07:00:00Z', '2026-03-09T03:59:59Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01', '2026-11-01T05:59:59Z', '2026-11-01T06:00:00Z', '2026-11-02T04:59:59Z', '2026-11-02T05:00:00Z']
  ])('preserves the cap through DST on %s and resets at local midnight', (day, beforeTransition, afterTransition, beforeMidnight, midnight) => {
    const capped = { ...state, notificationDay: day, notificationsSentToday: 3 };
    for (const at of [beforeTransition, afterTransition, beforeMidnight]) {
      const result = evaluateDeliveryGuards(input({ profileTimezone: 'America/New_York', clock: fixedClock(at), state: capped }));
      expect(result.notificationDay).toBe(day);
      expect(result.guardCodes).toEqual(['DAILY_CAP_REACHED']);
    }
    expect(evaluateDeliveryGuards(input({ profileTimezone: 'America/New_York', clock: fixedClock(midnight), state: capped })).guardCodes).toEqual([]);
  });

  it('uses validated client timezone fallback in the guard date and handles non-hour offsets', () => {
    expect(evaluateDeliveryGuards(input({ profileTimezone: 'invalid', clientTimezone: 'Asia/Tokyo', clock: fixedClock('2026-10-01T15:00:00Z') })).notificationDay).toBe('2026-10-02');
    expect(evaluateDeliveryGuards(input({ profileTimezone: null, clientTimezone: 'invalid', clock: fixedClock('2026-10-01T15:00:00Z') })).notificationDay).toBe('2026-10-01');
    expect(localDate(new Date('2026-10-01T18:15:00Z'), 'Asia/Kathmandu')).toBe('2026-10-02');
    expect(localDate(new Date('2026-12-31T15:00:00Z'), 'Asia/Tokyo')).toBe('2027-01-01');
  });

  it.each([
    ['2026-03-08T06:58:00Z', '2026-03-08T07:01:00Z', '2026-03-08T07:03:00Z'],
    ['2026-11-01T05:58:00Z', '2026-11-01T06:01:00Z', '2026-11-01T06:03:00Z']
  ])('uses elapsed instants for dedup across DST from %s', (processedAt, insideWindow, boundary) => {
    const processed = { ...state, latestContextFingerprint: 'sha256:test', latestContextProcessedAt: processedAt };
    expect(evaluateDeliveryGuards(input({ profileTimezone: 'America/New_York', state: processed, clock: fixedClock(insideWindow) })).guardCodes).toEqual(['DUPLICATE_CONTEXT']);
    expect(evaluateDeliveryGuards(input({ profileTimezone: 'America/New_York', state: processed, clock: fixedClock(boundary) })).guardCodes).toEqual([]);
  });

  it('resets the cap and step-goal guard at midnight while retaining recent context dedup', () => {
    const recent = {
      ...state, notificationsSentToday: 3, latestContextFingerprint: 'sha256:test', latestContextProcessedAt: '2026-10-01T14:59:59Z',
      recentAnchors: [{ triggerType: 'STEP_GOAL_REST' as const, anchorKey: '2026-10-01', notifiedAt: '2026-10-01T14:59:59Z' }]
    };
    expect(evaluateDeliveryGuards(input({ state: recent, clock: fixedClock('2026-10-01T15:00:00Z') })).guardCodes).toEqual(['DUPLICATE_CONTEXT']);
    expect(evaluateDeliveryGuards(input({ state: recent, contextFingerprint: 'sha256:next', clock: fixedClock('2026-10-01T15:00:00Z'),
      opportunity: { type: 'STEP_GOAL_REST', anchorKey: '2026-10-02' } })).guardCodes).toEqual([]);
  });
});
